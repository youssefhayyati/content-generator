<?php

namespace App\Models;

use App\Enums\Platform;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * A post picked on one network (X or Instagram) for reuse on the other. A person records
 * whether reuse is allowed and why before anything is adapted; the adapted caption always
 * credits the original author.
 */
#[Fillable(['user_id', 'account_id', 'placement', 'source_platform', 'source_url', 'author', 'source_text', 'asset_ids', 'permission', 'permission_note', 'status', 'error', 'caption', 'hashtags', 'options', 'story_text', 'attribution', 'post_id'])]
class Repost extends Model
{
    public const PERMISSIONS = ['pending', 'allowed', 'denied'];

    /** The networks a repost can come from and go to. */
    public const PLATFORMS = ['x', 'instagram'];

    /** @var array<string, mixed> */
    protected $attributes = ['status' => 'captured', 'permission' => 'pending', 'attribution' => true, 'source_platform' => 'x'];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'hashtags' => 'array',
            'options' => 'array',
            'asset_ids' => 'array',
            'attribution' => 'boolean',
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
     * @return BelongsTo<Post, $this>
     */
    public function post(): BelongsTo
    {
        return $this->belongsTo(Post::class);
    }

    /**
     * The source's photos and video, in their order, that are still in the library.
     *
     * @return Collection<int, Asset>
     */
    public function assets(): Collection
    {
        $ids = collect($this->asset_ids ?? [])->map(fn ($id) => (int) $id)->all();
        if ($ids === []) {
            return collect();
        }
        $found = $this->user->assets()->whereIn('id', $ids)->get()->keyBy('id');

        return collect($ids)->map(fn (int $id) => $found->get($id))->filter()->values();
    }

    public function sourceLabel(): string
    {
        return Platform::from($this->source_platform)->label();
    }

    /** The credit line: the author's handle, and where it lives (an @ on another network is someone else). */
    public function credit(): string
    {
        return 'Credit: @'.ltrim($this->author, '@').' on '.$this->sourceLabel();
    }

    /** The caption as it would post: the adaptation plus the credit line, when attribution is on. */
    public function creditedCaption(): string
    {
        return $this->attribution ? trim($this->caption ?? '')."\n\n".$this->credit() : trim($this->caption ?? '');
    }

    /**
     * The post's body: caption, credit and hashtags, within the target's character limit. When it
     * runs long the caption is shortened, never the credit.
     */
    public function body(): string
    {
        $limit = $this->account->platform->characterLimit();
        $tags = collect($this->hashtags ?? [])->map(fn (string $t) => '#'.$t)->implode(' ');
        $tail = ($this->attribution ? "\n\n".$this->credit() : '').($tags ? "\n\n".$tags : '');
        $caption = trim($this->caption ?? '');
        if (mb_strlen($caption.$tail) > $limit) {
            $caption = Str::limit($caption, max(0, $limit - mb_strlen($tail) - 1), '…');
        }

        return $caption.$tail;
    }
}
