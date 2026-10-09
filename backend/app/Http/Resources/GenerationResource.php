<?php

namespace App\Http\Resources;

use App\Models\Generation;
use App\Services\Ai\Models\ModelRegistry;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Generation
 */
class GenerationResource extends JsonResource
{
    /**
     * Transform the resource into an array.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        static $labels = null;
        $labels ??= collect(app(ModelRegistry::class)->all())->pluck('label', 'id');

        return [
            'id' => $this->id,
            'kind' => $this->kind,
            'model' => $this->model,
            'model_label' => $labels[$this->model] ?? ($this->model === 'studio/reel' ? 'Reel renderer' : $this->model),
            'status' => $this->status,
            'prompt' => $this->prompt,
            'params' => (object) ($this->params ?? []),
            'inputs' => $this->inputs()->map->summary(),
            'outputs' => $this->outputs()->map->summary(),
            'output_text' => $this->output_text,
            'error' => $this->error,
            'retry_of' => $this->retry_of,
            'recipe' => $this->recipe,
            'recipe_step' => $this->recipe_step,
            'parent_id' => $this->parent_id,
            'project_id' => $this->project_id,
            'cost' => $this->cost,
            'created_at' => $this->created_at?->toIso8601ZuluString(),
            'started_at' => $this->started_at?->toIso8601ZuluString(),
            'finished_at' => $this->finished_at?->toIso8601ZuluString(),
        ];
    }
}
