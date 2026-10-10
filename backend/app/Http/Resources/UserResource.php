<?php

namespace App\Http\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin User
 */
class UserResource extends JsonResource
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
            'name' => $this->name,
            'email' => $this->email,
            'email_verified' => $this->hasVerifiedEmail(),
            'avatar_url' => $this->avatar_url,
            'timezone' => $this->timezone,
            'preferences' => [
                'platforms' => $this->preferences['platforms'] ?? [],
                'formats' => $this->preferences['formats'] ?? [],
                'onboarding' => $this->preferences['onboarding'] ?? 'done',
                'studio' => $this->preferences['studio'] ?? null,
            ],
            'has_password' => $this->hasPassword(),
            'publishing_paused' => $this->publishingPaused(),
            'providers' => $this->socialAccounts()->pluck('provider'),
            'created_at' => $this->created_at?->toIso8601ZuluString(),
        ];
    }
}
