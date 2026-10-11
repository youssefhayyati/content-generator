<?php

namespace App\Http\Controllers;

use App\Models\AiUsage;
use App\Models\User;
use App\Services\Ai\Models\ModelRegistry;
use App\Services\Ai\Pricing;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * What the AI cost over a period: what providers billed, what the GPU pod's jobs came to at its hourly
 * rate, by day, by model and by what it was for. Every model call is a row in ai_usages; the phone
 * agent's own model use comes with each publishing run.
 */
class SpendingController extends Controller
{
    public const PERIODS = [7, 30, 90];

    /** What each part of the studio records its calls as. */
    private const USES = [
        'lab' => 'Creative Lab', 'studio' => 'Creative Lab',
        'composer' => 'Writing posts',
        'campaign' => 'Campaigns', 'agent' => 'Campaigns', 'profile' => 'Campaigns',
        'flow' => 'Flows',
        'clips' => 'Highlights',
        'inspire' => 'Trends',
        'sound' => 'Sound', 'listen' => 'Sound',
        'evals' => 'Model tests',
        'phone' => 'Phone posting',
    ];

    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        $days = in_array((int) $request->query('days'), self::PERIODS, true) ? (int) $request->query('days') : 30;
        $tz = $user->timezone ?: config('app.timezone');
        $from = CarbonImmutable::now($tz)->subDays($days - 1)->startOfDay();

        $calls = $this->calls($user, $from);
        $before = $this->calls($user, $from->subDays($days))->filter(fn ($c) => $c['at'] < $from);

        $byDay = $calls->groupBy(fn ($c) => $c['at']->toDateString());
        $daily = collect(range(0, $days - 1))->map(function ($i) use ($from, $byDay) {
            $date = $from->addDays($i)->toDateString();
            $that = $byDay->get($date, collect());

            return [
                'date' => $date,
                'billed' => round($that->where('billing', Pricing::BILLED)->sum('cost'), 4),
                'estimated' => round($that->where('billing', Pricing::ESTIMATED)->sum('cost'), 4),
            ];
        });

        $models = $calls->groupBy(fn ($c) => $c['provider'].'/'.$c['name'])->map(function (Collection $group) {
            $c = $group->first();
            $rate = $c['provider'] === 'phone' ? ['billing' => Pricing::BILLED, 'rate' => 'What the phone agent reports per run'] : Pricing::rate($c['provider'], $c['name']);

            return [
                'id' => $c['provider'].'/'.$c['name'],
                'label' => $c['label'],
                'where' => $c['where'],
                'billing' => $rate['billing'],
                'rate' => $rate['rate'],
                'calls' => $group->count(),
                'cost' => round($group->sum('cost'), 4),
                'seconds' => (int) $group->sum('seconds'),
            ];
        })->sortBy([['cost', 'desc'], ['calls', 'desc']])->values();

        $uses = $calls->groupBy(fn ($c) => self::USES[str($c['purpose'] ?? '')->before(':')->toString()] ?? 'Other')
            ->map(fn (Collection $group, string $label) => ['label' => $label, 'cost' => round($group->sum('cost'), 4), 'calls' => $group->count()])
            ->sortByDesc('cost')->values();

        $pod = $calls->where('billing', Pricing::ESTIMATED);

        return response()->json([
            'days' => $days,
            'total' => round($calls->sum('cost'), 4),
            'billed' => round($calls->where('billing', Pricing::BILLED)->sum('cost'), 4),
            'estimated' => round($pod->sum('cost'), 4),
            'previous' => round($before->sum('cost'), 4),
            'calls' => $calls->count(),
            'unpriced' => $models->where('billing', Pricing::UNPRICED)->sum('calls'),
            'pod' => ['hourly' => Pricing::podHourly(), 'seconds' => (int) $pod->sum('seconds'), 'cost' => round($pod->sum('cost'), 4)],
            'daily' => $daily,
            'models' => $models,
            'uses' => $uses,
        ]);
    }

    /**
     * Every call since $from, the same shape whether it's a model call or a phone run.
     *
     * @return Collection<int, array{at: CarbonImmutable, provider: string, name: string, label: string, where: string, purpose: string|null, billing: string, cost: float, seconds: int}>
     */
    private function calls(User $user, CarbonImmutable $from): Collection
    {
        $tz = $from->getTimezone();
        $usage = AiUsage::where('user_id', $user->id)->where('created_at', '>=', $from->utc())
            ->get(['provider', 'model', 'purpose', 'billing', 'cost', 'seconds', 'created_at'])
            ->map(function (AiUsage $u) use ($tz) {
                $name = Pricing::name($u->provider, $u->model);

                return [
                    'at' => CarbonImmutable::instance($u->created_at)->setTimezone($tz),
                    'provider' => $u->provider, 'name' => $name,
                    'label' => $this->labels()[$u->provider.'/'.$name] ?? $name,
                    'where' => (string) (config("ai.providers.{$u->provider}.reach") ?? (in_array($u->provider, Pricing::HERE, true) ? 'This server' : $u->provider)),
                    'purpose' => $u->purpose, 'billing' => $u->billing, 'cost' => (float) $u->cost, 'seconds' => (int) $u->seconds,
                ];
            });

        $phone = $user->publishingRuns()->where('started_at', '>=', $from->utc())->where('spend', '>', 0)->get(['spend', 'started_at'])
            ->map(fn ($r) => [
                'at' => CarbonImmutable::instance($r->started_at)->setTimezone($tz),
                'provider' => 'phone', 'name' => 'agent', 'label' => 'Phone agent', 'where' => 'Your phones',
                'purpose' => 'phone', 'billing' => Pricing::BILLED, 'cost' => (float) $r->spend, 'seconds' => 0,
            ]);

        return $usage->concat($phone)->values();
    }

    /** @var array<string, string>|null */
    private ?array $labels = null;

    /**
     * Every model's name as the pickers show it ("ACE-Step song", not "acestep"), the pod's included.
     *
     * @return array<string, string>
     */
    private function labels(): array
    {
        return $this->labels ??= ['studio/reel' => 'Reel renderer', ...rescue(fn () => collect(app(ModelRegistry::class)->all())->pluck('label', 'id')->all(), [], report: false)];
    }
}
