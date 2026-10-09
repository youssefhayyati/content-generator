<?php

namespace App\Services\Studio;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\ActionLog;
use App\Models\User;
use App\Services\Flows\Flows;

/**
 * A circuit breaker for brand safety. Every comment gets a quick sentiment read the moment it
 * arrives (AI triage refines it later). When an account's recent comments turn negative fast —
 * enough of them, a high enough share — Storm Guard freezes that account's publishing on its
 * own, tells the operator, and starts any flow listening for storms. Nothing scheduled goes
 * out into a backlash; a person gives the all clear.
 */
class StormGuard
{
    /** At or below this a comment counts as negative. */
    public const NEGATIVE = -25;

    private const NEGATIVE_WORDS = [
        // English
        'awful', 'angry', 'boycott', 'broken', 'cancel', 'cancelled', 'cheated', 'complaint', 'disappointed', 'disappointing',
        'disgusting', 'disgrace', 'embarrassing', 'fake', 'fraud', 'garbage', 'hate', 'hated', 'horrible', 'joke', 'liar', 'liars',
        'lied', 'lies', 'misleading', 'pathetic', 'refund', 'ripoff', 'rip-off', 'rude', 'scam', 'scammers', 'shame',
        'shameful', 'terrible', 'trash', 'unacceptable', 'unfollow', 'unfollowed', 'useless', 'worst', 'worse', 'wrong', 'racist',
        'offensive', 'insulting', 'tone-deaf', 'stolen', 'stole', 'lawsuit', 'sue', 'toxic', 'ashamed', 'nobody', 'poor',
        // French
        'arnaque', 'arnaqueurs', 'honte', 'honteux', 'nul', 'nulle', 'déçu', 'déçue', 'décevant', 'horrible', 'remboursement',
        'jamais', 'pire', 'dégoûtant', 'menteur', 'menteurs', 'scandale', 'scandaleux', 'inadmissible', 'inacceptable', 'mensonge',
        'boycotter', 'raciste', 'volé', 'escroc', 'escrocs', 'colère',
        // Spanish, a few
        'estafa', 'vergüenza', 'pésimo', 'horrible', 'mentira',
    ];

    private const POSITIVE_WORDS = [
        'love', 'loved', 'loving', 'amazing', 'awesome', 'beautiful', 'best', 'brilliant', 'cute', 'excellent', 'fantastic',
        'favorite', 'favourite', 'gorgeous', 'great', 'happy', 'incredible', 'lovely', 'nice', 'obsessed', 'perfect', 'stunning',
        'thank', 'thanks', 'wonderful', 'wow', 'yes', 'bravo', 'congrats', 'congratulations', 'beau', 'belle', 'magnifique',
        'merci', 'génial', 'parfait', 'superbe', 'adore', 'j\'adore', 'top', 'sublime', 'canon', 'hâte', 'gracias', 'precioso',
    ];

    private const NEGATIVE_EMOJI = ['😡', '🤬', '👎', '💩', '😤', '🤮', '😠', '🙄', '😒', '🖕'];

    private const POSITIVE_EMOJI = ['❤', '😍', '🔥', '👏', '🙌', '💕', '🥰', '✨', '😊', '💖', '🤩', '👍', '💯'];

    private const NEGATIONS = ['not', 'no', 'never', "don't", 'dont', "isn't", "wasn't", 'pas', 'jamais', 'plus'];

    public function __construct(private readonly Flows $flows) {}

    /**
     * A fast first read, no AI: -100 (furious) to 100 (delighted). Word lists in English and
     * French, emoji, negation ("not great"), shouting and stacked exclamation marks.
     */
    public function read(string $text): int
    {
        $lower = mb_strtolower($text);
        $words = preg_split('/[^\p{L}\p{N}\'-]+/u', $lower, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $neg = 0.0;
        $pos = 0.0;
        foreach ($words as $i => $word) {
            $negated = $i > 0 && in_array($words[$i - 1], self::NEGATIONS, true) || $i > 1 && in_array($words[$i - 2], self::NEGATIONS, true);
            if (in_array($word, self::NEGATIVE_WORDS, true)) {
                // "not bad" leans kind, but only a little.
                if ($negated) {
                    $pos += 0.5;
                } else {
                    $neg += 1;
                }
            } elseif (in_array($word, self::POSITIVE_WORDS, true)) {
                if ($negated) {
                    $neg += 1;
                } else {
                    $pos += 1;
                }
            }
        }
        foreach (self::NEGATIVE_EMOJI as $e) {
            $neg += mb_substr_count($text, $e);
        }
        foreach (self::POSITIVE_EMOJI as $e) {
            $pos += mb_substr_count($text, $e) * 0.8;
        }
        // "never again", "never buying", "plus jamais": strong on their own.
        if (preg_match('/\bnever (again|buying|ordering|coming back)\b|plus jamais/u', $lower)) {
            $neg += 1.5;
        }
        if ($neg + $pos === 0.0) {
            return 0;
        }
        $score = ($pos - $neg) / ($pos + $neg) * 100;
        // Shouting and !!! make whatever it is louder.
        $letters = preg_replace('/[^\p{L}]/u', '', $text);
        $loud = (mb_strlen($letters) >= 8 && $letters === mb_strtoupper($letters)) || preg_match('/!{2,}/', $text);
        $strength = min(1.0, 0.55 + 0.15 * ($neg + $pos)) * ($loud ? 1.25 : 1);

        return (int) max(-100, min(100, round($score * $strength)));
    }

    /**
     * How the account's comments are going in the guard's window, against its settings.
     *
     * @return array{account_id: int, enabled: bool, window_minutes: int, min_comments: int, threshold: int, total: int, negative: int, share: int, pressure: int, tripped: bool, storm_at: string|null, reason: string|null, held_posts: int}
     */
    public function pressure(Account $account): array
    {
        $s = $account->stormSettings();
        $recent = $account->comments()->where('created_at', '>=', now()->subMinutes($s['window_minutes']))->whereNotNull('sentiment')->pluck('sentiment');
        $total = $recent->count();
        $negative = $recent->filter(fn (int $v) => $v <= self::NEGATIVE)->count();
        $share = $total ? (int) round($negative / $total * 100) : 0;

        return [
            'account_id' => $account->id,
            ...$s,
            'total' => $total,
            'negative' => $negative,
            'share' => $share,
            // 0–100: how close the guard is to tripping. Both the volume and the share have to be there.
            'pressure' => (int) round(min(1, $total / max(1, $s['min_comments'])) * min(1, $share / max(1, $s['threshold'])) * 100),
            'tripped' => $account->isHeld(),
            'storm_at' => $account->storm_at?->toIso8601ZuluString(),
            'reason' => $account->storm_reason,
            'held_posts' => $account->isHeld() ? $account->posts()->where('status', PostStatus::Scheduled)->count() : 0,
        ];
    }

    /** Look at the account now; trip the breaker if the storm is real. True when it tripped. */
    public function check(Account $account): bool
    {
        $s = $account->stormSettings();
        if (! $s['enabled'] || $account->isHeld()) {
            return false;
        }
        $p = $this->pressure($account);
        if ($p['total'] < $s['min_comments'] || $p['share'] < $s['threshold']) {
            return false;
        }
        $reason = "{$p['negative']} of the last {$p['total']} comments in {$s['window_minutes']} minutes are negative ({$p['share']}%).";
        $taken = Account::whereKey($account->id)->whereNull('storm_at')->update(['storm_at' => now(), 'storm_reason' => $reason]);
        if (! $taken) {
            return false;
        }
        $account->refresh();
        $held = $account->posts()->where('status', PostStatus::Scheduled)->count();
        ActionLog::record($account->user, 'agent:storm-guard', 'storm.tripped', $account,
            "Froze publishing on {$account->label()}: {$reason} {$held} scheduled ".($held === 1 ? 'post is' : 'posts are').' held.', 'auto', $p);
        $this->flows->stormTripped($account, [...$p, 'tripped' => true]);

        return true;
    }

    /** The operator looked, and it's safe again: publishing on the account resumes. */
    public function clear(Account $account, User $by): void
    {
        abort_unless($account->isHeld(), 409, 'This account isn’t frozen.');
        $account->update(['storm_at' => null, 'storm_reason' => null]);
        ActionLog::record($by, 'you', 'storm.cleared', $account, "Gave the all clear on {$account->label()}: publishing resumes.", 'approved');
    }
}
