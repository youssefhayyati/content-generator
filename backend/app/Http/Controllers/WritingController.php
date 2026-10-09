<?php

namespace App\Http\Controllers;

use App\Http\Requests\WritePostRequest;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\StreamedEvent;
use Symfony\Component\HttpFoundation\StreamedResponse;

class WritingController extends Controller
{
    /**
     * Whether the composer can offer AI writing, and with which models.
     */
    public function options(ModelRegistry $models): JsonResponse
    {
        $text = collect($models->all('text'));

        return response()->json([
            'enabled' => $text->contains('available', true),
            'default' => $models->defaultText(),
            // One list, local and cloud, each saying how it's reached and whether it can run.
            'models' => $text->map(fn (array $m) => collect($m)->only(['id', 'label', 'kind', 'reach', 'local', 'available', 'reason', 'purpose', 'score']))->values(),
        ]);
    }

    /**
     * Write a post, or rewrite the draft, as server-sent events: `delta` events carry the text
     * as it's written, then one `done`, or an `error` with a message to show.
     */
    public function write(WritePostRequest $request, ModelRegistry $models, UsageMeter $usage): StreamedResponse|JsonResponse
    {
        try {
            [$generator, $model] = $models->text($request->model());
        } catch (GenerationFailed) {
            return response()->json(['message' => 'AI writing isn’t switched on yet.'], 503);
        }

        $prompt = $request->prompt();
        $user = $request->user();

        return response()->eventStream(function () use ($generator, $prompt, $model, $usage, $user) {
            $usage->push($user, null, 'composer');
            try {
                foreach ($generator->stream($model, $prompt->system(), $prompt->user()) as $text) {
                    yield new StreamedEvent('delta', ['text' => $text]);
                }

                yield new StreamedEvent('done', ['model' => $model]);
            } catch (GenerationFailed $e) {
                yield new StreamedEvent('error', ['message' => $e->getMessage()]);
            } finally {
                $usage->pop();
            }
        }, endStreamWith: null);
    }
}
