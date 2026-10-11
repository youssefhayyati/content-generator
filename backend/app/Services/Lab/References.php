<?php

namespace App\Services\Lab;

use App\Models\Campaign;
use App\Models\CampaignPhoto;
use App\Services\Media\AssetStore;
use Illuminate\Support\Facades\Storage;

/**
 * A campaign's photos (its logo, the product, the people in it) on a new project's canvas: each
 * kind as a Media node under the brief, ready to connect to the pictures, edits and designs. A
 * photo is copied into the gallery once, and every project after uses that copy.
 */
final class References
{
    public const GROUPS = ['logo' => 'Logo', 'product' => 'The product', 'person' => 'People', 'place' => 'Places', 'other' => 'Other pictures'];

    public function __construct(private readonly AssetStore $store) {}

    /**
     * The campaign's photos as gallery pictures, by kind, in the order of GROUPS.
     *
     * @return array<string, list<int>>
     */
    public function assets(Campaign $campaign): array
    {
        $disk = Storage::disk('local');
        $groups = [];
        foreach ($campaign->photos()->with('asset')->get() as $photo) {
            /** @var CampaignPhoto $photo */
            if (! $photo->asset) {
                if (! $disk->exists($photo->path)) {
                    continue;
                }
                $name = ($photo->title ?: ($photo->kind ?: 'photo')).'.'.pathinfo($photo->path, PATHINFO_EXTENSION);
                $asset = $this->store->fromContents($campaign->user, $disk->get($photo->path), (string) $photo->mime, $name, 'upload');
                $photo->update(['asset_id' => $asset->id]);
            }
            $kind = isset(self::GROUPS[$photo->kind]) ? $photo->kind : 'other';
            $groups[$kind][] = (int) $photo->asset_id;
        }

        return array_filter(array_map(fn (string $k) => $groups[$k] ?? [], array_combine(array_keys(self::GROUPS), array_keys(self::GROUPS))));
    }

    /**
     * Media nodes for them, one per kind, in a column from (x, y).
     *
     * @param  array<string, list<int>>  $groups
     * @return list<array<string, mixed>>
     */
    public static function nodes(array $groups, float $x, float $y): array
    {
        $nodes = [];
        foreach ($groups as $kind => $ids) {
            $nodes[] = ['id' => "ref-{$kind}", 'type' => 'source.media', 'x' => $x, 'y' => $y + count($nodes) * 300,
                'params' => ['assets' => array_values($ids)], 'label' => self::GROUPS[$kind]];
        }

        return $nodes;
    }
}
