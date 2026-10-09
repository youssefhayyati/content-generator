<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Collection;

/**
 * One request for text, an image, a video, a voiceover, music or a reel, and what came back. A failed one can
 * be retried, sent to another model, or rerun with an edited prompt: each makes a new
 * generation that points back at it (`retry_of`).
 */
#[Fillable(['project_id', 'campaign_item_id', 'shot', 'kind', 'model', 'prompt', 'params', 'input_asset_ids', 'status', 'external_id', 'status_url', 'output_text', 'output_asset_ids', 'error', 'retry_of', 'recipe', 'recipe_step', 'parent_id', 'cost', 'started_at', 'finished_at'])]
class Generation extends Model
{
    public const KINDS = ['text', 'image', 'video', 'voice', 'music', 'reel'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'params' => 'array',
            'input_asset_ids' => 'array',
            'output_asset_ids' => 'array',
            'cost' => 'float',
            'recipe_step' => 'integer',
            'shot' => 'integer',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function isFinished(): bool
    {
        return in_array($this->status, ['succeeded', 'failed', 'canceled'], true);
    }

    /**
     * @return Collection<int, Asset>
     */
    public function inputs(): Collection
    {
        return $this->assetsIn($this->input_asset_ids ?? []);
    }

    /**
     * @return Collection<int, Asset>
     */
    public function outputs(): Collection
    {
        return $this->assetsIn($this->output_asset_ids ?? []);
    }

    /**
     * @param  list<int>  $ids
     * @return Collection<int, Asset>
     */
    private function assetsIn(array $ids): Collection
    {
        return $ids ? Asset::whereIn('id', $ids)->get()->sortBy(fn (Asset $a) => array_search($a->id, $ids))->values() : collect();
    }
}
