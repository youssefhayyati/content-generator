<?php

namespace App\Services\Campaigns;

use App\Models\Account;
use App\Models\AgentStep;
use App\Models\AiUsage;
use App\Models\Campaign;
use App\Models\CampaignItem;
use App\Models\ItemVariant;
use App\Services\Ai\GenerationFailed;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\UsageMeter;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * The campaign team. Each agent is one structured call with a brief of its own; each turn is a
 * logged step with what it made and what it cost.
 */
class Agents
{
    public function __construct(
        private readonly ModelRegistry $models,
        private readonly UsageMeter $usage,
        private readonly CampaignBrief $brief,
        private readonly Voice $voice,
    ) {}

    /* ------------------------------------------------------------------ */
    /* Writer: the plan */
    /* ------------------------------------------------------------------ */

    /**
     * @return array{big_idea: string, pillars: list<array{name: string, why: string}>, items: list<array<string, mixed>>}
     */
    public function plan(Campaign $campaign): array
    {
        $n = $this->postCount($campaign);
        $accounts = $campaign->accounts()->pluck('id')->all();

        return $this->step($campaign, 'writer', function () use ($campaign, $n, $accounts) {
            $plan = $this->ask(
                <<<'TXT'
                You are the writer on a social media team. From the client's brief you plan a campaign: one big idea, two to four content pillars, and the posts to make. Each post is one master piece of content that is later adapted for each account it goes to.

                Rules:
                - Ground every post in the brief: the real story, products, facts and the audience's problems. Never invent facts, numbers, prices, dates or quotes the brief doesn't give.
                - Formats: image (one photo), carousel (2–5 images), video (a short clip built shot by shot), text (words only: only for X, LinkedIn or Facebook).
                - Spread the posts across the pillars and vary the formats. Send each post to the accounts where it fits, by account id.
                - title: up to 8 words. message: the one thing the post must say. hook: its opening line.
                TXT,
                $this->brief->text($campaign)."\n\nPlan {$n} posts for this campaign.",
                [
                    'type' => 'object',
                    'properties' => [
                        'big_idea' => ['type' => 'string'],
                        'pillars' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => ['name' => ['type' => 'string'], 'why' => ['type' => 'string']], 'required' => ['name', 'why'], 'additionalProperties' => false]],
                        'items' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                            'title' => ['type' => 'string'],
                            'pillar' => ['type' => 'string'],
                            'format' => ['type' => 'string', 'enum' => CampaignItem::FORMATS],
                            'message' => ['type' => 'string'],
                            'hook' => ['type' => 'string'],
                            'account_ids' => ['type' => 'array', 'items' => ['type' => 'integer']],
                        ], 'required' => ['title', 'pillar', 'format', 'message', 'hook', 'account_ids'], 'additionalProperties' => false]],
                    ],
                    'required' => ['big_idea', 'pillars', 'items'],
                    'additionalProperties' => false,
                ],
                'medium',
            );

            // Models sometimes answer with the natural name instead of the schema's.
            $plan['items'] = $plan['items'] ?? $plan['posts'] ?? [];
            $plan['pillars'] = collect($plan['pillars'] ?? [])->map(fn ($p) => is_array($p) ? $p : ['name' => (string) $p, 'why' => ''])->all();

            // Only accounts that are actually in the campaign.
            $plan['items'] = collect($plan['items'])->take(16)->map(fn (array $i) => [
                ...$i,
                'account_ids' => array_values(array_intersect($i['account_ids'] ?? [], $accounts)) ?: $accounts,
                'format' => in_array($i['format'] ?? null, CampaignItem::FORMATS, true) ? $i['format'] : 'image',
            ])->values()->all();

            return [$plan, 'Planned '.count($plan['items']).' posts around “'.Str::limit($plan['big_idea'] ?? '', 80).'”.'];
        });
    }

    /* ------------------------------------------------------------------ */
    /* Visual director */
    /* ------------------------------------------------------------------ */

    /**
     * @param  Collection<int, CampaignItem>  $items
     * @return list<array{index: int, visual: string, image_prompts: list<string>, reference_photo: int, shots: list<array{description: string, camera: string, duration: int}>}>
     */
    public function visuals(Campaign $campaign, Collection $items): array
    {
        return $this->step($campaign, 'visual_director', function () use ($campaign, $items) {
            $list = $items->values()->map(fn (CampaignItem $i, int $n) => ($n + 1).". [{$i->format}] {$i->title}: {$i->message}")->join("\n");
            $result = $this->ask(
                <<<'TXT'
                You are the visual director on a social media team. For each planned post, describe the visual: what we see, the setting, light and mood, in the brand's look. Write prompts for an image generator: concrete and visual, no words on the image unless the post needs them.

                - When one of the client's reference photos fits, give its number in reference_photo (0 for none), so the generator keeps that person or product identical.
                - image: one prompt. carousel: one prompt per slide, 2–5. video: one prompt for the opening frame, and a shot list of 3–5 shots, 2–5 seconds each, each with what's in frame and the camera move. text: no prompts and no shots.
                - index is the post's number in the list.
                TXT,
                $this->brief->text($campaign, withVoices: false)."\n\n## Posts\n{$list}",
                [
                    'type' => 'object',
                    'properties' => ['items' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                        'index' => ['type' => 'integer'],
                        'visual' => ['type' => 'string'],
                        'image_prompts' => ['type' => 'array', 'items' => ['type' => 'string']],
                        'reference_photo' => ['type' => 'integer'],
                        'shots' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                            'description' => ['type' => 'string'], 'camera' => ['type' => 'string'], 'duration' => ['type' => 'integer'],
                        ], 'required' => ['description', 'camera', 'duration'], 'additionalProperties' => false]],
                    ], 'required' => ['index', 'visual', 'image_prompts', 'reference_photo', 'shots'], 'additionalProperties' => false]]],
                    'required' => ['items'],
                    'additionalProperties' => false,
                ],
                'medium',
            );

            $visuals = $result['items'] ?? [];

            return [$visuals, 'Directed the look of '.count($visuals).' posts'.(collect($visuals)->sum(fn ($v) => count($v['shots'] ?? [])) ? ', with shot lists for the videos.' : '.')];
        });
    }

    /* ------------------------------------------------------------------ */
    /* Writer: the master copy */
    /* ------------------------------------------------------------------ */

    /**
     * @param  Collection<int, CampaignItem>  $items
     * @return array<int, string> caption by item id
     */
    public function copy(Campaign $campaign, Collection $items): array
    {
        return $this->step($campaign, 'writer', function () use ($campaign, $items) {
            $list = $items->values()->map(fn (CampaignItem $i, int $n) => ($n + 1).". [{$i->format}] {$i->title}\n   Message: {$i->message}\n   Hook: {$i->hook}")->join("\n");
            $result = $this->ask(
                <<<'TXT'
                You write the master caption for each post: the version the adapter then tailors for each account. Open with the hook, say the message, end with the brief's call to action. Plain text with line breaks, no Markdown, no hashtags (they're added per platform), at most 1,200 characters. Never invent facts beyond the brief. Write in the brief's content language. index is the post's number in the list.
                TXT,
                $this->brief->text($campaign, withVoices: false)."\n\n## Posts\n{$list}",
                [
                    'type' => 'object',
                    'properties' => ['captions' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => ['index' => ['type' => 'integer'], 'caption' => ['type' => 'string']], 'required' => ['index', 'caption'], 'additionalProperties' => false]]],
                    'required' => ['captions'],
                    'additionalProperties' => false,
                ],
                'medium',
            );

            $ids = $items->values()->pluck('id');
            $captions = collect($result['captions'] ?? [])
                ->filter(fn ($c) => isset($ids[$c['index'] - 1]))
                ->mapWithKeys(fn ($c) => [$ids[$c['index'] - 1] => trim($c['caption'])])
                ->all();

            return [$captions, 'Wrote '.count($captions).' master captions.'];
        });
    }

    /* ------------------------------------------------------------------ */
    /* Adapter */
    /* ------------------------------------------------------------------ */

    /**
     * Versions of these items for one account, in its voice.
     *
     * @param  Collection<int, CampaignItem>  $items
     * @param  array<int, string>  $feedback  rejection notes, by item id
     * @return array<int, array{mode: string, caption: string, placement: string}> by item id
     */
    public function adapt(Campaign $campaign, Account $account, Collection $items, array $feedback = []): array
    {
        $specs = config("platforms.{$account->platform->value}");

        return $this->step($campaign, 'adapter', function () use ($campaign, $account, $items, $feedback, $specs) {
            $list = $items->values()->map(function (CampaignItem $i, int $n) use ($feedback) {
                $media = $i->format === 'text' ? 'no media' : $i->assets()->map(fn ($a) => $a->kind.($a->width ? " {$a->width}×{$a->height}" : ''))->join(', ');

                return ($n + 1).". [{$i->format}; media: ".($media ?: 'pending')."] {$i->title}\nMaster caption:\n{$i->caption}"
                    .(isset($feedback[$i->id]) ? "\nThe operator rejected the last version: {$feedback[$i->id]}" : '');
            })->join("\n\n");
            $placements = collect($specs)->map(fn ($s, $id) => "{$id} ({$s['label']}, caption up to ".($s['caption'] ?: 'none').')')->join('; ');

            $result = $this->ask(
                <<<'TXT'
                You adapt a campaign's posts for one account, in its voice. For each post choose shared (the master caption already works on this platform, in this voice) or adapted (rewrite it), and write the caption that will go out.

                - Keep the message, the facts and the call to action. Never add facts.
                - Respect the platform's caption limit and habits: hashtags only where the platform uses them (Instagram up to 5 relevant ones, TikTok 3–5, LinkedIn up to 3, X at most 2, Facebook few or none). Plain text, line breaks for structure, no Markdown.
                - Follow the account's voice exactly: its Never and Always rules and the operator's instructions win over everything else.
                - If the operator rejected the last version, fix exactly what they said.
                - placement: one of the options given, fitting the post's format and media.
                - index is the post's number in the list.
                TXT,
                $this->voice->context($account)."\n\nPlatform: {$account->platform->label()}. Placements: {$placements}.\n\n## Brief\n".$this->brief->text($campaign, withVoices: false)."\n\n## Posts\n{$list}",
                [
                    'type' => 'object',
                    'properties' => ['variants' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                        'index' => ['type' => 'integer'],
                        'mode' => ['type' => 'string', 'enum' => ['shared', 'adapted']],
                        'caption' => ['type' => 'string'],
                        'placement' => ['type' => 'string', 'enum' => array_keys($specs)],
                    ], 'required' => ['index', 'mode', 'caption', 'placement'], 'additionalProperties' => false]]],
                    'required' => ['variants'],
                    'additionalProperties' => false,
                ],
                'low',
            );

            $ids = $items->values()->pluck('id');
            $variants = collect($result['variants'] ?? [])
                ->filter(fn ($v) => isset($ids[$v['index'] - 1]))
                ->mapWithKeys(fn ($v) => [$ids[$v['index'] - 1] => [
                    'mode' => $v['mode'] === 'shared' ? 'shared' : 'adapted',
                    'caption' => trim($v['caption']),
                    'placement' => array_key_exists($v['placement'], $specs) ? $v['placement'] : array_key_first($specs),
                ]])->all();

            return [$variants, 'Adapted '.count($variants)." posts for @{$account->handle} on {$account->platform->label()}."];
        });
    }

    /* ------------------------------------------------------------------ */
    /* QA */
    /* ------------------------------------------------------------------ */

    /**
     * @param  Collection<int, ItemVariant>  $variants
     * @return array<int, array{status: string, issues: list<string>}> by variant id
     */
    public function qa(Campaign $campaign, Collection $variants): array
    {
        return $this->step($campaign, 'qa', function () use ($campaign, $variants) {
            $list = $variants->map(fn (ItemVariant $v) => "Variant {$v->id} for @{$v->account->handle} on {$v->account->platform->label()}\n"
                .'Voice: '.Str::limit(str_replace("\n", ' · ', $this->voice->context($v->account)), 700)."\n"
                ."Caption:\n{$v->caption}")->join("\n\n---\n\n");

            $result = $this->ask(
                <<<'TXT'
                You are QA on a social media team. Check each variant before a person approves it. Flag:
                - anything that breaks the account's voice rules (its Never and Always lines, the operator's instructions);
                - any fact, number, price, date or claim that the brief doesn't give;
                - a missing or wrong call to action;
                - the wrong language;
                - anything that reads as spam or could embarrass the brand.

                status: pass (ready), warn (publishable, but a person should look at the issues), fail (must change). Keep each issue to one short sentence. id is the variant's number.
                TXT,
                "## Brief\n".$this->brief->text($campaign, withVoices: false)."\n\n## Variants\n{$list}",
                [
                    'type' => 'object',
                    'properties' => ['variants' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                        'id' => ['type' => 'integer'],
                        'status' => ['type' => 'string', 'enum' => ['pass', 'warn', 'fail']],
                        'issues' => ['type' => 'array', 'items' => ['type' => 'string']],
                    ], 'required' => ['id', 'status', 'issues'], 'additionalProperties' => false]]],
                    'required' => ['variants'],
                    'additionalProperties' => false,
                ],
                'low',
            );

            $results = collect($result['variants'] ?? [])->keyBy('id')->map(fn ($v) => ['status' => $v['status'], 'issues' => array_values($v['issues'] ?? [])])->all();
            $flagged = collect($results)->where('status', '!=', 'pass')->count();

            return [$results, 'Checked '.count($results).' variants'.($flagged ? "; {$flagged} need a look." : '; all pass.')];
        });
    }

    /* ------------------------------------------------------------------ */
    /* Editorial profile */
    /* ------------------------------------------------------------------ */

    /**
     * Profile changes that would bring future content closer to what the operator approves.
     *
     * @return list<array{field: string, to: string, reason: string}>
     */
    public function suggestProfile(Account $account): array
    {
        $liked = $account->memories()->where('kind', 'example')->latest('id')->limit(8)->pluck('content');
        $rejected = ItemVariant::where('account_id', $account->id)->whereNotNull('feedback')->latest('id')->limit(8)->get(['caption', 'feedback']);
        if ($liked->isEmpty() && $rejected->isEmpty()) {
            return [];
        }

        [$generator, $name] = $this->models->text($this->agentModel());
        $result = $this->usage->within($account->user, $account, 'profile', fn () => $generator->json(
            $name,
            'You maintain an account’s editorial profile. Propose up to three specific changes to its fields that would bring future content closer to what the operator approves. Only propose a change you have clear evidence for; return none if there is no clear pattern. Write each field as it should read in full.',
            "Current profile:\n".$this->voice->context($account)
                ."\n\nPosts the operator liked:\n".$liked->map(fn ($c) => '- '.Str::limit($c, 400))->join("\n")
                ."\n\nContent the operator rejected, and why:\n".$rejected->map(fn ($v) => '- "'.Str::limit($v->caption, 200).'" — '.$v->feedback)->join("\n"),
            ['type' => 'object', 'properties' => ['changes' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                'field' => ['type' => 'string', 'enum' => Account::PROFILE_FIELDS], 'to' => ['type' => 'string'], 'reason' => ['type' => 'string'],
            ], 'required' => ['field', 'to', 'reason'], 'additionalProperties' => false]]], 'required' => ['changes'], 'additionalProperties' => false],
            'medium',
        ));

        return array_slice($result['changes'] ?? [], 0, 3);
    }

    /* ------------------------------------------------------------------ */

    /** How many posts fit the period at the brief's rhythm: 3 to 12. */
    public function postCount(Campaign $campaign): int
    {
        $rhythm = mb_strtolower(($campaign->brief['rhythm'] ?? null) ?: ($campaign->fields['rhythm'] ?? ''));
        $perWeek = match (true) {
            str_contains($rhythm, 'every day') || str_contains($rhythm, 'daily') => 7,
            (bool) preg_match('/(\d+)\s*(?:times|posts|x)/', $rhythm, $m) => (int) $m[1],
            default => 3,
        };
        $days = $campaign->period_start && $campaign->period_end ? $campaign->period_start->diffInDays($campaign->period_end) + 1 : 14;

        return max(3, min(12, (int) round($perWeek * $days / 7)));
    }

    /**
     * Run one agent's turn as a logged step: who, what it made, what it cost.
     *
     * @template T
     *
     * @param  callable(AgentStep): array{0: T, 1: string}  $work  returns [result, summary]
     * @return T
     */
    private function step(Campaign $campaign, string $agent, callable $work): mixed
    {
        $step = $campaign->steps()->create(['agent' => $agent, 'status' => 'running', 'started_at' => now(), 'model' => $this->agentModel()]);

        try {
            [$result, $summary] = $this->usage->within($campaign->user, $step, "agent:{$agent}", fn () => $work($step));
        } catch (GenerationFailed $e) {
            $step->update(['status' => 'failed', 'error' => $e->getMessage(), 'finished_at' => now()]);
            throw $e;
        }

        $step->update([
            'status' => 'done',
            'summary' => Str::limit($summary, 250),
            'output' => is_array($result) ? $result : ['value' => $result],
            'cost' => (float) AiUsage::where('context_type', $step->getMorphClass())->where('context_id', $step->id)->sum('cost'),
            'finished_at' => now(),
        ]);

        return $result;
    }

    private function ask(string $system, string $prompt, array $schema, string $effort): array
    {
        [$generator, $name] = $this->models->text($this->agentModel());

        return $generator->json($name, $system, $prompt, $schema, $effort);
    }

    /** The configured agent model, or the best one that can actually run right now. */
    private function agentModel(): string
    {
        return $this->models->textModelOr((string) config('ai.agents.model'));
    }
}
