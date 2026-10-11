<?php

namespace App\Services\Lab\Nodes;

use App\Services\Ai\GenerationFailed;
use App\Services\Lab\Brief;
use App\Services\Lab\Executor;
use App\Services\Lab\Media;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;
use App\Services\Sound\SoundClient;
use App\Services\Sound\VoiceRouter;
use App\Services\Sound\VoiceStudioClient;
use Illuminate\Support\Str;

/** Voiceover: Kokoro on this server, or a VoiceStudio voice (vs:…), picked or cloned from a recording, every word timed. */
class Voice extends Executor
{
    public function start(NodeJob $job): array
    {
        $script = $this->prompt($job, 'script', 'script');
        if ($script === '') {
            throw new NodeFailed('Write the script, or connect one.');
        }
        if (mb_strlen($script) > 2500) {
            throw new NodeFailed('Keep a voiceover under 2,500 characters (about two and a half minutes).');
        }
        $voice = $this->cloned($job) ?? ($job->params['voice'] ?: Brief::account($job->inputs->brief())?->soundSettings()['voice']);
        // No voice picked: FlowAI Sound's default when it runs, else the first voice on VoiceStudio (the pod).
        if (! $voice || (! VoiceRouter::isVoiceStudio($voice) && ! app(SoundClient::class)->up())) {
            $voice = app(SoundClient::class)->up() ? 'af_heart' : (collect(rescue(fn () => app(VoiceStudioClient::class)->voices(), [], report: false))->first()['id'] ?? throw new NodeFailed('No voice can read it: VoiceStudio (the pod) isn’t answering.'));
        }
        $model = $this->model(VoiceRouter::isVoiceStudio($voice) ? VoiceRouter::MODEL : 'sound/kokoro');
        $job->stage('Reading it aloud');
        $job->generate('voice', $model['id'], $script, ['voice' => $voice, 'speed' => (float) ($job->params['speed'] ?? 1.0)]);

        return ['wait' => true];
    }

    /**
     * The voice cloned from the recording connected to "Voice to clone", made once per recording
     * (its id is kept on the file).
     */
    private function cloned(NodeJob $job): ?string
    {
        $sample = $job->inputs->asset('clone', ['audio', 'video']);
        if (! $sample) {
            return null;
        }
        $known = $sample->meta['voice_clone'] ?? null;
        if ($known && rescue(fn () => app(VoiceStudioClient::class)->voice(VoiceRouter::strip($known)), null, report: false)) {
            return $known;
        }

        $job->stage('Cloning the voice');
        $wav = Media::tmp('wav');
        try {
            Media::ffmpeg(['-i', Media::path($sample), '-t', '20', '-vn', '-ac', '1', '-ar', '24000', $wav], 'take the voice from the recording');
            // What it says makes the clone closer, when the whole recording fits in what's sent.
            $text = ($sample->duration ?? 99) <= 20 ? (string) ($sample->meta['transcript']['text'] ?? '') : '';
            $voice = app(VoiceStudioClient::class)->clone('Cloned · '.Str::limit(pathinfo($sample->name, PATHINFO_FILENAME), 40, ''), $wav, $text);
        } catch (GenerationFailed $e) {
            throw new NodeFailed($e->getMessage());
        } finally {
            @unlink($wav);
        }
        $sample->update(['meta' => [...($sample->meta ?? []), 'voice_clone' => $voice['id']]]);

        return $voice['id'];
    }
}
