<?php

namespace App\Services\Lab\Nodes;

use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use App\Services\Lab\Brief;
use App\Services\Lab\Catalog;
use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;
use Illuminate\Support\Str;

/**
 * Write and Translate: a text model writes, in the brief's (and the account's) voice, from what's
 * connected. Plain text comes back, ready for the next node.
 */
class Write extends Executor
{
    private const SYSTEM = 'You write content for a brand studio. Reply with the content only, in plain text: no preamble, no notes, no quotes around it, no Markdown. Never invent facts, prices, dates or numbers that you were not given: leave them out, or say them the way they were given.';

    private const LIMITS = ['instagram' => 2200, 'x' => 280, 'tiktok' => 2200, 'youtube' => 5000, 'linkedin' => 3000, 'facebook' => 5000, 'pinterest' => 500];

    public function __construct(private readonly ModelRegistry $models, private readonly UsageMeter $usage) {}

    public function start(NodeJob $job): array
    {
        $p = $job->params;
        $model = $job->engine->modelFor($job->node);
        if (! $model) {
            throw new NodeFailed('No text model is set up. Add one under Models.');
        }
        if (! $model['available']) {
            throw new NodeFailed("{$model['label']} isn’t available: {$model['reason']}");
        }
        [$generator, $name] = $this->models->text($model['id']);
        $brief = $this->brief($job);

        if ($job->node['type'] === 'text.translate') {
            $source = $job->inputs->text('text');
            $system = self::SYSTEM.' You translate.';
            $prompt = "Translate this into {$p['language']}, the way a native speaker would say it: keep the meaning, the tone, the line breaks, emoji and hashtags (translate a hashtag only when there's a natural one). Reply with the translation only.\n\n".Str::limit($source, 12000);
        } else {
            [$system, $prompt] = $this->writing($job, $brief);
        }

        $job->stage('Writing with '.$model['label']);
        $text = $this->usage->within($job->user(), $job->run, 'lab', function () use ($generator, $name, $system, $prompt) {
            $out = '';
            foreach ($generator->stream($name, $system, $prompt) as $chunk) {
                $out .= $chunk;
            }

            return $out;
        });
        $text = $this->clean($text);
        if ($text === '') {
            throw new NodeFailed('The model wrote nothing. Try again, or another model.');
        }
        if (($p['task'] ?? '') === 'caption' && ($limit = self::LIMITS[$p['platform']] ?? null) && mb_strlen($text) > $limit) {
            $text = Str::limit($text, $limit - 1, '…');
        }

        return ['outputs' => ['text' => ['type' => 'text', 'text' => $text, 'model' => $model['id']]]];
    }

    /**
     * @param  array<string, mixed>|null  $brief
     * @return array{0: string, 1: string}
     */
    private function writing(NodeJob $job, ?array $brief): array
    {
        $p = $job->params;
        $platform = Catalog::PLATFORMS[$p['platform']] ?? 'social media';
        $count = max(1, (int) ($p['count'] ?? 4));
        $length = ['short' => 'Keep it short.', 'medium' => '', 'long' => 'It can be longer and richer.'][$p['length'] ?? 'medium'] ?? '';
        $task = match ($p['task'] ?? 'caption') {
            'caption' => match ($p['platform']) {
                'x' => 'Write a post for X: one idea, the strongest sentence first, under 280 characters including spaces (aim for 120 to 240), at most one or two hashtags and only inside a sentence.',
                'linkedin' => 'Write a LinkedIn post: a first line that earns the click on "see more", short paragraphs, a clear takeaway, no hashtag block (three hashtags at most, at the end).',
                'tiktok', 'youtube' => "Write a {$platform} caption: one punchy line, then up to two short lines, then three to five specific hashtags.",
                default => "Write a {$platform} caption. The first line is the hook: it is all people see before \"more\", about 125 characters. Then one to three short paragraphs with an empty line between them, one clear call to action, and three to five specific hashtags on the last line. Emoji only if the brand uses them.",
            },
            'hook' => "Write one hook line for {$platform}: under 12 words, something that stops the scroll. One line only.",
            'headline' => 'Write a headline to put on the picture: at most 7 words, no full stop at the end. One line only.',
            'script' => 'Write a voiceover script, spoken and natural, short sentences. '.['short' => 'About 15 seconds (40 words).', 'medium' => 'About 30 seconds (80 words).', 'long' => 'About 60 seconds (150 words).'][$p['length'] ?? 'medium'],
            'lines' => "Write {$count} lines for a video, one per picture, in order: each one or two short spoken sentences (under 160 characters), together telling one story from a hook to a call to action. One line per line of your reply, nothing else, no numbering.",
            'thread' => "Write a thread of {$count} posts for {$platform}: each under 280 characters, the first one must work on its own. Put each post on its own line, separated by an empty line, no numbering.",
            'hashtags' => "Write 5 to 10 specific hashtags for {$platform}, on one line, separated by spaces.",
            'prompt' => 'Write a prompt for an image model: one clear subject, the setting, the light, the composition, the lens or style. Leave calm, empty space where a headline will go. Never ask for words, letters or logos in the picture. One paragraph.',
            default => 'Write what is asked below.',
        };
        $system = self::SYSTEM;
        if ($brief && ($context = Brief::forWriter($brief, (string) ($p['brief_use'] ?? 'both'))) !== '') {
            $system .= "\n\nWrite for this brand and campaign; its rules win over everything else:\n".Str::limit($context, 10000);
        }
        $asked = Brief::fill(trim((string) ($p['instructions'] ?? '')), $brief);
        $from = $job->inputs->text('context');
        $prompt = implode("\n\n", array_filter([
            $task.' '.$length,
            $asked !== '' ? "What it should say: {$asked}" : null,
            $from !== '' ? "Work from this:\n".Str::limit($from, 14000) : null,
        ]));

        return [$system, $prompt];
    }

    private function clean(string $text): string
    {
        $text = trim($text);
        $text = preg_replace('/^(here(’|\')?s|here is|sure[,!])[^\n]*:\s*\n+/i', '', $text) ?? $text;
        if (preg_match('/^["“”](.*)["“”]$/su', $text, $m) && ! str_contains($m[1], "\n")) {
            $text = $m[1];
        }

        return trim($text);
    }
}
