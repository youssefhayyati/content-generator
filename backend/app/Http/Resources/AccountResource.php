<?php

namespace App\Http\Resources;

use App\Models\Account;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Account
 */
class AccountResource extends JsonResource
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
            'platform' => $this->platform,
            'handle' => $this->handle,
            'name' => $this->name,
            'label' => $this->label(),
            'timezone' => $this->timezone,
            'device' => $this->whenLoaded('device', fn () => $this->device ? ['id' => $this->device->id, 'name' => $this->device->name, 'driver' => $this->device->driver, 'status' => $this->device->status] : null),
            'device_id' => $this->device_id,
            'automation' => $this->automation,
            'autonomy' => $this->autonomy,
            'min_gap_minutes' => $this->min_gap_minutes,
            'profile' => (object) ($this->profile ?? []),
            'storm_guard' => $this->stormSettings(),
            'sound' => $this->soundSettings(),
            'storm_at' => $this->storm_at?->toIso8601ZuluString(),
            'storm_reason' => $this->storm_reason,
            'posts_count' => $this->whenCounted('posts'),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
