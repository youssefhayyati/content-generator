<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Storage;

#[Fillable(['name', 'email', 'password', 'avatar_url', 'timezone', 'preferences'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable implements MustVerifyEmail
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'preferences' => 'array',
            'publishing_paused_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        // The database takes the rows with the account; the files they point at go here.
        static::deleted(function (User $user) {
            Storage::disk('local')->deleteDirectory(Campaign::directoryFor($user->id));
            Storage::disk('local')->deleteDirectory("assets/{$user->id}");
        });
    }

    /**
     * @return HasMany<Post, $this>
     */
    public function posts(): HasMany
    {
        return $this->hasMany(Post::class);
    }

    /**
     * @return HasMany<Campaign, $this>
     */
    public function campaigns(): HasMany
    {
        return $this->hasMany(Campaign::class);
    }

    /**
     * @return HasMany<Asset, $this>
     */
    public function assets(): HasMany
    {
        return $this->hasMany(Asset::class);
    }

    /**
     * @return HasMany<Account, $this>
     */
    public function accounts(): HasMany
    {
        return $this->hasMany(Account::class);
    }

    /**
     * @return HasMany<Device, $this>
     */
    public function devices(): HasMany
    {
        return $this->hasMany(Device::class);
    }

    /**
     * Every publishing run on this studio's phones.
     *
     * @return HasMany<PublishingRun, $this>
     */
    public function publishingRuns(): HasMany
    {
        return $this->hasMany(PublishingRun::class);
    }

    /**
     * @return HasMany<Repost, $this>
     */
    public function reposts(): HasMany
    {
        return $this->hasMany(Repost::class);
    }

    /**
     * @return HasMany<Comment, $this>
     */
    public function comments(): HasMany
    {
        return $this->hasMany(Comment::class);
    }

    /**
     * @return HasMany<Investigation, $this>
     */
    public function investigations(): HasMany
    {
        return $this->hasMany(Investigation::class);
    }

    /**
     * @return HasMany<ActionLog, $this>
     */
    public function actionLogs(): HasMany
    {
        return $this->hasMany(ActionLog::class);
    }

    /**
     * @return HasMany<Generation, $this>
     */
    public function generations(): HasMany
    {
        return $this->hasMany(Generation::class);
    }

    /**
     * @return HasMany<Project, $this>
     */
    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    /**
     * @return HasMany<SocialAccount, $this>
     */
    public function socialAccounts(): HasMany
    {
        return $this->hasMany(SocialAccount::class);
    }

    /**
     * @return HasMany<QueueSlot, $this>
     */
    public function queueSlots(): HasMany
    {
        return $this->hasMany(QueueSlot::class);
    }

    /**
     * @return HasMany<Flow, $this>
     */
    public function flows(): HasMany
    {
        return $this->hasMany(Flow::class);
    }

    /**
     * @return HasMany<FlowRun, $this>
     */
    public function flowRuns(): HasMany
    {
        return $this->hasMany(FlowRun::class);
    }

    /**
     * @return HasMany<InboxNote, $this>
     */
    public function inboxNotes(): HasMany
    {
        return $this->hasMany(InboxNote::class);
    }

    /**
     * Accounts created through Google or GitHub have no password until they set one.
     */
    public function hasPassword(): bool
    {
        return filled($this->password);
    }

    /** The stop button: while pressed, nothing publishes automatically. */
    public function publishingPaused(): bool
    {
        return $this->publishing_paused_at !== null;
    }

    public function timezoneOrUtc(): string
    {
        return $this->timezone ?? 'UTC';
    }
}
