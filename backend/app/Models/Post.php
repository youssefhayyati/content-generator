<?php

namespace App\Models;

use App\Enums\PostFormat;
use App\Enums\PostStatus;
use Database\Factories\PostFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable(['title', 'body', 'format', 'placement', 'platforms', 'status', 'account_id', 'campaign_id', 'variant_id', 'scheduled_at', 'published_at', 'approved_at', 'approved_by', 'post_url', 'error', 'project_id', 'node_id', 'device_id', 'metrics', 'metrics_at'])]
class Post extends Model
{
    /** @use HasFactory<PostFactory> */
    use HasFactory;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'format' => PostFormat::class,
            'status' => PostStatus::class,
            'platforms' => 'array',
            'scheduled_at' => 'datetime',
            'published_at' => 'datetime',
            'approved_at' => 'datetime',
            'metrics' => 'array',
            'metrics_at' => 'datetime',
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
     * @return BelongsTo<Account, $this>
     */
    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    /**
     * The Creative Lab project it was made in (its Post node is node_id there).
     *
     * @return BelongsTo<Project, $this>
     */
    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * The phone it goes out on when not its account's own (chosen on its Post node).
     *
     * @return BelongsTo<Device, $this>
     */
    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    /**
     * @return BelongsTo<Campaign, $this>
     */
    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }

    /**
     * @return BelongsTo<ItemVariant, $this>
     */
    public function variant(): BelongsTo
    {
        return $this->belongsTo(ItemVariant::class, 'variant_id');
    }

    /**
     * The media the post carries, in order.
     *
     * @return BelongsToMany<Asset, $this>
     */
    public function assets(): BelongsToMany
    {
        return $this->belongsToMany(Asset::class, 'post_assets')->withPivot('position')->orderByPivot('position');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    /**
     * Every attempt to publish this post from a phone, oldest first.
     *
     * @return HasMany<PublishingRun, $this>
     */
    public function runs(): HasMany
    {
        return $this->hasMany(PublishingRun::class);
    }

    /**
     * The latest attempt: how it went, and the screenshot it ended on (the calendar shows it).
     *
     * @return HasOne<PublishingRun, $this>
     */
    public function latestRun(): HasOne
    {
        return $this->hasOne(PublishingRun::class)->latestOfMany();
    }

    public function isApproved(): bool
    {
        return $this->approved_at !== null;
    }

    /**
     * @param  list<int>  $assetIds
     */
    public function syncAssets(array $assetIds): void
    {
        $this->assets()->sync(collect($assetIds)->values()->mapWithKeys(fn (int $id, int $i) => [$id => ['position' => $i]])->all());
    }
}
