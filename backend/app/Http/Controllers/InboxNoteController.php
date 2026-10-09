<?php

namespace App\Http\Controllers;

use App\Models\InboxNote;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Notes flows leave in the Inbox stay until someone has read them and says so. */
class InboxNoteController extends Controller
{
    public function dismiss(Request $request, InboxNote $note): JsonResponse
    {
        abort_unless($note->user()->is($request->user()), 404);
        $note->update(['dismissed_at' => now()]);

        return response()->json(['ok' => true]);
    }
}
