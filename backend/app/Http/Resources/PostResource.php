<?php

namespace App\Http\Resources;

use App\Models\Post;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Post
 */
class PostResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'body' => $this->body,
            'format' => $this->format,
            'placement' => $this->placement,
            'platforms' => $this->platforms,
            'status' => $this->status,
            'account' => $this->account ? [
                'id' => $this->account->id,
                'platform' => $this->account->platform,
                'handle' => $this->account->handle,
                'automation' => $this->account->automation,
            ] : null,
            'assets' => $this->assets->map->summary(),
            'campaign' => $this->campaign_id ? ['id' => $this->campaign_id, 'name' => $this->campaign?->title()] : null,
            'approved_at' => $this->approved_at?->toIso8601ZuluString(),
            'post_url' => $this->post_url,
            'error' => $this->error,
            // Made in Creative Lab: the project and its Post node, to open it there.
            'lab' => $this->project_id ? ['project_id' => $this->project_id, 'node_id' => $this->node_id] : null,
            'metrics' => $this->metrics,
            'metrics_at' => $this->metrics_at?->toIso8601ZuluString(),
            // The latest publishing run, when loaded: its outcome and the screenshot it ended on, as proof
            'run' => $this->whenLoaded('latestRun', fn () => $this->latestRun ? [
                'id' => $this->latestRun->id,
                'outcome' => $this->latestRun->status,
                'attempt' => $this->latestRun->attempt,
                'ended_at' => $this->latestRun->ended_at?->toIso8601ZuluString(),
                'note' => $this->latestRun->evidence['note'] ?? $this->latestRun->error,
                'steps' => count($this->latestRun->steps ?? []),
                'screenshot_url' => $this->latestRun->screenshot_id ? "/api/assets/{$this->latestRun->screenshot_id}/file" : null,
            ] : null),
            'scheduled_at' => $this->scheduled_at?->toIso8601ZuluString(),
            'published_at' => $this->published_at?->toIso8601ZuluString(),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'updated_at' => $this->updated_at?->toIso8601ZuluString(),
        ];
    }
}
