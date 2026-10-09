<?php

namespace App\Http\Controllers;

use App\Models\Account;
use App\Models\ActionLog;
use App\Services\Studio\StormGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * Storm Guard: how close each account is to tripping, its settings, and the all clear.
 */
class StormGuardController extends Controller
{
    public function __construct(private readonly StormGuard $guard) {}

    public function index(Request $request): JsonResponse
    {
        $accounts = $request->user()->accounts()->orderBy('platform')->orderBy('handle')->get();

        return response()->json($accounts->map(fn (Account $a) => [
            ...$this->guard->pressure($a),
            'handle' => $a->handle,
            'platform' => $a->platform,
        ]));
    }

    public function update(Request $request, Account $account): JsonResponse
    {
        Gate::authorize('update', $account);
        $data = $request->validate([
            'enabled' => ['sometimes', 'boolean'],
            'window_minutes' => ['sometimes', 'integer', 'min:10', 'max:1440'],
            'min_comments' => ['sometimes', 'integer', 'min:2', 'max:500'],
            'threshold' => ['sometimes', 'integer', 'min:20', 'max:100'],
        ]);
        $account->update(['storm_guard' => [...$account->stormSettings(), ...$data]]);
        ActionLog::record($request->user(), 'you', 'storm.settings', $account, "Storm Guard on {$account->label()}: ".($account->stormSettings()['enabled']
            ? "trips at {$account->stormSettings()['threshold']}% negative over {$account->stormSettings()['min_comments']}+ comments in {$account->stormSettings()['window_minutes']} minutes."
            : 'off.'));

        return response()->json([...$this->guard->pressure($account), 'handle' => $account->handle, 'platform' => $account->platform]);
    }

    /** The operator looked: it's safe, publishing resumes. */
    public function clear(Request $request, Account $account): JsonResponse
    {
        Gate::authorize('update', $account);
        $this->guard->clear($account, $request->user());

        return response()->json([...$this->guard->pressure($account->fresh()), 'handle' => $account->handle, 'platform' => $account->platform]);
    }
}
