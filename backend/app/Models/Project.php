<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A Creative Lab project: a canvas of nodes, each one a step (a source, a model, an edit, a post),
 * joined port to port. `canvas` (version 2) is {version: 2, rev, nodes: [{id, type, x, y, params,
 * pin?, branch?, label?}], edges: [{from, out, to, in}], view: {x, y, zoom}} (App\Services\Lab\Graph).
 * Older canvases (notes, texts, assets and generations on a board) are read as version 2.
 */
#[Fillable(['name', 'canvas'])]
class Project extends Model
{
    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['canvas' => 'array'];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return HasMany<Generation, $this>
     */
    public function generations(): HasMany
    {
        return $this->hasMany(Generation::class);
    }

    /**
     * @return HasMany<NodeRun, $this>
     */
    public function nodeRuns(): HasMany
    {
        return $this->hasMany(NodeRun::class);
    }

    /**
     * @return HasMany<Post, $this>
     */
    public function posts(): HasMany
    {
        return $this->hasMany(Post::class);
    }
}
