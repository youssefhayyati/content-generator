<?php

namespace App\Services\Lab\Nodes;

use App\Enums\PostFormat;
use App\Enums\PostStatus;
use App\Models\ActionLog;
use App\Models\Asset;
use App\Models\Post;
use App\Services\Lab\Brief;
use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;
use App\Services\PostQueue;
use App\Services\Publishing\PlatformSpecs;
use App\Services\Publishing\Publisher;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Post: what came before becomes a FlowAI post, on an account, as a draft or scheduled. Saving it
 * with a time is a person's approval (as in the Composer); the assistant only ever saves drafts.
 * The node keeps one post until it's published: running it again changes that post, and a post
 * already out makes a new one. "Now" books the phone right away; the run, its screenshot and the
 * post's numbers come back to the node.
 */
class PostNode extends Executor
{
    public function __construct(private readonly PostQueue $queue, private readonly PlatformSpecs $specs, private readonly Publisher $publisher) {}

    public function start(NodeJob $job): array
    {
        $p = $job->params;
        $user = $job->user();
        // A Where it goes node before it says the account and the kind of post.
        $channel = $job->inputs->first('channel');
        if ($channel) {
            $p = [...$p, 'account_id' => $channel['account_id'], 'placement' => $channel['placement'] ?? null];
        }
        $account = ! empty($p['account_id']) ? $user->accounts()->find($p['account_id']) : null;
        if (! $account) {
            throw new NodeFailed($channel ? 'The account of Where it goes isn’t there anymore.' : 'Pick the account it goes to, or connect a Where it goes node.');
        }
        $when = (string) ($p['when'] ?? 'draft');
        if ($job->run->by !== 'you' && $when !== 'draft') {
            throw new NodeFailed('Only you can schedule or publish. The assistant saved nothing: open the Post node and press Schedule.');
        }
        $assets = $job->inputs->assets('media', ['image', 'video']);
        $caption = trim($job->inputs->text('caption')) ?: trim((string) ($p['caption'] ?? ''));
        $caption = Brief::fill($caption, $job->inputs->brief());
        // Every video made from someone else's credits them.
        foreach ($assets->map(fn (Asset $a) => $a->meta['credit'] ?? null)->filter()->unique() as $credit) {
            foreach (explode("\n", $credit) as $line) {
                if ($line !== '' && ! str_contains($caption, $line)) {
                    $caption = trim($caption."\n\n".$line);
                }
            }
        }
        $limit = $account->platform->characterLimit();
        if (mb_strlen($caption) > $limit) {
            throw new NodeFailed('The caption is '.mb_strlen($caption)." characters; {$account->platform->label()} takes {$limit}. Shorten it.");
        }
        if ($caption === '' && $assets->isEmpty()) {
            throw new NodeFailed('Connect the media or the caption, or write the caption here.');
        }
        $device = ! empty($p['device_id']) ? $user->devices()->find($p['device_id']) : null;
        // Going out from a phone and none picked: the account's, or the only phone there is.
        if ($when !== 'draft' && ! $device && ! $account->device_id && $user->devices()->count() === 1) {
            $device = $user->devices()->first();
        }
        $driver = in_array($p['driver'] ?? null, ['direct', 'agent', 'auto'], true) ? $p['driver'] : null;
        $format = $assets->contains('kind', 'video') ? PostFormat::Video : ($assets->isNotEmpty() ? PostFormat::Image : PostFormat::Text);
        $check = $this->specs->check($account->platform, $p['placement'] ?? null, $caption, $assets);

        // The post this node made before, while it isn't out yet.
        $post = $job->project->posts()->where('node_id', $job->node['id'])
            ->whereIn('status', [PostStatus::Draft, PostStatus::Scheduled, PostStatus::Failed])->latest('id')->first()
            ?? $user->posts()->make();
        $post->fill([
            'title' => Str::limit(trim((string) ($p['title'] ?? '')) ?: Str::limit(strtok($caption, "\n") ?: $job->project->name, 60, ''), 120, ''),
            'body' => $caption !== '' ? $caption : ' ',
            'format' => $format,
            'placement' => $check['placement'],
            'platforms' => [$account->platform->value],
            'account_id' => $account->id,
            'project_id' => $job->project->id,
            'node_id' => $job->node['id'],
            'device_id' => $device?->id,
            'phone_driver' => $driver,
            'campaign_id' => Brief::campaign($job->inputs->brief())?->id ?? $post->campaign_id,
            'error' => null,
        ]);

        $scheduled = match ($when) {
            'at' => ! empty($p['at']) ? Carbon::parse($p['at'], $user->timezoneOrUtc())->utc() : throw new NodeFailed('Pick the date and time.'),
            'queue' => $this->queue->nextFree($user, $post->exists ? $post->id : null) ?? throw new NodeFailed('The queue has no posting times yet. Add some under Automations, or pick a time.'),
            'now' => now(),
            default => null,
        };
        if ($when === 'at' && $scheduled->isPast()) {
            throw new NodeFailed('That time has already passed. Pick one in the future.');
        }
        if ($scheduled && ! collect($check['checks'])->where('status', 'fail')->isEmpty()) {
            throw new NodeFailed($account->platform->label().' won’t take it as it is: '.collect($check['checks'])->where('status', 'fail')->pluck('label')->join('; ').'.');
        }
        if ($scheduled) {
            $post->status = PostStatus::Scheduled;
            $post->scheduled_at = $scheduled;
            $post->approved_at = now();
            $post->approved_by = $user->id;
        } else {
            $post->status = PostStatus::Draft;
            $post->scheduled_at = null;
            $post->approved_at = $post->approved_by = null;
        }
        $post->save();
        $post->syncAssets($assets->pluck('id')->all());

        ActionLog::record($user, $job->run->by === 'you' ? 'you' : 'agent:assistant', 'post.'.$post->status->value, $post, match (true) {
            $when === 'now' => 'Publishing “'.Str::limit($post->title, 48).'” now, from Creative Lab.',
            (bool) $scheduled => 'Scheduled “'.Str::limit($post->title, 48).'” for '.$scheduled->toIso8601ZuluString().', from Creative Lab.',
            default => 'Saved “'.Str::limit($post->title, 48).'” as a draft, from Creative Lab.',
        }, $scheduled ? 'approved' : null);

        $note = null;
        $who = ['direct' => 'your agent', 'agent' => 'the phone’s agent', 'auto' => 'the phone’s agent (yours if it fails)'][$driver ?? 'auto'];
        $phone = $device ?? $account->device;
        if ($when === 'now') {
            if (! $phone) {
                $note = 'Saved for now, but there’s no phone to post it from: add one on the Phones page, or pick one here.';
            } elseif (rescue(fn () => $this->publisher->open($post->fresh(), byHand: true), null, report: false)) {
                $note = "Posting now from {$phone->name}, by {$who}.";
            } else {
                $note = "{$phone->name} is busy or paused: it goes out as soon as it’s free, by {$who}.";
            }
        } elseif ($scheduled) {
            $note = ! $phone ? 'Scheduled, but there’s no phone to post it from: add one on the Phones page.'
                : (! $account->automation ? 'Scheduled, but @'.$account->handle.'’s automated publishing is off, so it won’t go out by itself: turn it on under Accounts.'
                    : "Goes out from {$phone->name}, by {$who}.");
        }

        return ['outputs' => ['post' => [
            'type' => 'post', 'post_id' => $post->id, 'status' => $post->fresh()->status->value,
            'warnings' => collect($check['checks'])->whereIn('status', ['warn', 'fail'])->map(fn ($c) => $c['label'].($c['detail'] ? ": {$c['detail']}" : ''))->values()->all(),
            'note' => $note,
        ]]];
    }
}
