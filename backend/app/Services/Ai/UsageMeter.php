<?php

namespace App\Services\Ai;

use App\Models\AiUsage;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/**
 * Records what each model call cost. Callers say who it's for and what it's part of with
 * `within()`; the generators report tokens, and Pricing says what that cost.
 */
class UsageMeter
{
    private ?User $user = null;

    private ?Model $context = null;

    private ?string $purpose = null;

    /** @var list<array{0: User|null, 1: Model|null, 2: string|null}> */
    private array $stack = [];

    /**
     * @template T
     *
     * @param  callable(): T  $run
     * @return T
     */
    public function within(?User $user, ?Model $context, ?string $purpose, callable $run): mixed
    {
        $this->push($user, $context, $purpose);

        try {
            return $run();
        } finally {
            $this->pop();
        }
    }

    /**
     * For streams, which run lazily: push before iterating, pop in a finally once done.
     */
    public function push(?User $user, ?Model $context, ?string $purpose): void
    {
        $this->stack[] = [$this->user, $this->context, $this->purpose];
        [$this->user, $this->context, $this->purpose] = [$user, $context, $purpose];
    }

    public function pop(): void
    {
        [$this->user, $this->context, $this->purpose] = array_pop($this->stack) ?? [null, null, null];
    }

    /**
     * One call. Text calls give their tokens and are priced from them; media runs give what they cost
     * and how it's known (App\Services\Ai\Pricing::run), and pod jobs how long they held the GPU.
     */
    public function record(string $provider, string $model, int $inputTokens, int $outputTokens, ?float $cost = null, ?string $billing = null, float $seconds = 0): AiUsage
    {
        $priced = $cost === null ? Pricing::tokens($provider, $model, $inputTokens, $outputTokens) : ['cost' => $cost, 'billing' => $billing ?? Pricing::BILLED];

        return AiUsage::create([
            'user_id' => $this->user?->id,
            'provider' => $provider,
            'model' => $model,
            'purpose' => $this->purpose,
            'input_tokens' => $inputTokens,
            'output_tokens' => $outputTokens,
            'cost' => $priced['cost'],
            'billing' => $priced['billing'],
            'seconds' => (int) round($seconds),
            'context_type' => $this->context?->getMorphClass(),
            'context_id' => $this->context?->getKey(),
        ]);
    }

    /** Whether a caller has already said who the calls are for. */
    public function attributed(): bool
    {
        return $this->user !== null;
    }
}
