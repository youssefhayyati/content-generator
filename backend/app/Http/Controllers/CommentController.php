<?php

namespace App\Http\Controllers;

use App\Models\ActionLog;
use App\Models\Comment;
use App\Services\Community\Community;
use App\Services\Flows\Flows;
use App\Services\Studio\Autonomy;
use App\Services\Studio\StormGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;

/**
 * The comment inbox (area 11): comments come in per account, the AI triages each one —
 * reply, ignore, or send to a human — and a human approves every reply before it goes out,
 * unless a mode-B rule the operator approved covers it.
 */
class CommentController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $comments = $request->user()->comments()->with('account:id,platform,handle')->latest('id')->limit(200)->get();

        return response()->json($comments->map(fn (Comment $c) => $this->out($c)));
    }

    /** A comment lands in the inbox (the connector's job in production; by hand here). */
    public function store(Request $request, StormGuard $guard, Flows $flows): JsonResponse
    {
        $data = $request->validate([
            'account_id' => ['required', Rule::exists('accounts', 'id')->where('user_id', $request->user()->id)],
            'author' => ['required', 'string', 'max:120'],
            'body' => ['required', 'string', 'max:2000'],
            'post_ref' => ['nullable', 'string', 'max:300'],
        ]);

        $comment = $request->user()->comments()->create([...$data, 'sentiment' => $guard->read($data['body'])]);
        $comment->load('account');
        // Storm Guard looks at every comment the moment it lands, then flows listening for comments run.
        $guard->check($comment->account);
        rescue(fn () => $flows->commentArrived($comment));

        return response()->json($this->out($comment->fresh('account')), 201);
    }

    /** AI triage: reply (drafted), ignore, or send to a human. Mode B may send replies itself. */
    public function triage(Request $request, Comment $comment, Community $community, StormGuard $guard): JsonResponse
    {
        $this->own($request, $comment);
        abort_unless($comment->status === 'new', 409, 'This comment was already triaged.');
        abort_unless($community->aiAvailable($request->user()), 502, 'Triage needs AI and a confirmed account.');

        $result = $community->triage($comment);
        $account = $comment->account;
        if ($result['sentiment'] !== null) {
            // The AI read the mood better than the word lists did: Storm Guard takes its word.
            $comment->update(['sentiment' => $result['sentiment']]);
            $guard->check($account);
        }

        if ($result['decision'] === 'reply' && $result['draft']) {
            $comment->update(['triage' => ['decision' => 'reply', 'reason' => $result['reason']], 'draft' => $result['draft'], 'status' => 'drafted']);
            // Mode B: a rule the operator approved sends it without the per-reply approval.
            if (app(Autonomy::class)->decide($account, 'comment.send_reply', ['today' => $account->repliesSentToday()]) === 'run') {
                $this->deliver($comment, $comment->draft);
                ActionLog::record($request->user(), 'agent:autonomy', 'comment.auto_replied', $comment, "Replied to @{$comment->author} by a mode-B rule.", 'auto');
            }
        } elseif ($result['decision'] === 'ignore') {
            $comment->update(['triage' => ['decision' => 'ignore', 'reason' => $result['reason']], 'status' => 'ignored']);
        } else {
            $comment->update(['triage' => ['decision' => 'human', 'reason' => $result['reason']], 'status' => 'human']);
        }

        return response()->json($this->out($comment->fresh('account')));
    }

    /** A human approves the reply (edited or not); only then is it sent. */
    public function send(Request $request, Comment $comment): JsonResponse
    {
        $this->own($request, $comment);
        abort_unless(in_array($comment->status, ['drafted', 'human'], true), 409, 'Nothing to send on this comment.');
        $data = $request->validate(['reply' => ['required', 'string', 'max:1000']]);

        $this->deliver($comment, $data['reply']);
        ActionLog::record($request->user(), 'you', 'comment.replied', $comment, "Replied to @{$comment->author}.");

        return response()->json($this->out($comment->fresh('account')));
    }

    public function ignore(Request $request, Comment $comment): JsonResponse
    {
        $this->own($request, $comment);
        abort_unless(in_array($comment->status, ['new', 'drafted', 'human'], true), 409);
        $comment->update(['status' => 'ignored']);

        return response()->json($this->out($comment->fresh('account')));
    }

    public function destroy(Request $request, Comment $comment): Response
    {
        $this->own($request, $comment);
        abort_if($comment->status === 'sent', 409, 'Sent replies stay on the record.');
        $comment->delete();

        return response()->noContent();
    }

    /** The reply "goes out": recorded with its timestamp. No real platform call exists yet. */
    private function deliver(Comment $comment, string $reply): void
    {
        $comment->update(['reply' => $reply, 'status' => 'sent', 'sent_at' => now()]);
    }

    private function own(Request $request, Comment $comment): void
    {
        abort_unless($comment->user()->is($request->user()), 404);
    }

    /**
     * @return array<string, mixed>
     */
    private function out(Comment $c): array
    {
        return [
            'id' => $c->id,
            'author' => $c->author,
            'body' => $c->body,
            'post_ref' => $c->post_ref,
            'status' => $c->status,
            'triage' => $c->triage,
            'draft' => $c->draft,
            'reply' => $c->reply,
            'sent_at' => $c->sent_at?->toIso8601ZuluString(),
            'sentiment' => $c->sentiment,
            'account' => $c->relationLoaded('account') && $c->account ? ['id' => $c->account->id, 'platform' => $c->account->platform, 'handle' => $c->account->handle] : null,
            'created_at' => $c->created_at?->toIso8601ZuluString(),
        ];
    }
}
