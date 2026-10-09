<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

class InspirationController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(DB::table('inspirations')->where('user_id', $request->user()->id)->latest('updated_at')->get());
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'url' => ['required', 'url:https', 'max:500'],
            'title' => ['required', 'string', 'max:255'],
            'creator' => ['nullable', 'string', 'max:255'],
            'board' => ['required', 'string', 'max:80'],
            'notes' => ['nullable', 'string', 'max:4000'],
        ]);
        $host = strtolower(parse_url($data['url'], PHP_URL_HOST) ?? '');
        abort_unless(in_array($host, ['youtube.com', 'www.youtube.com', 'youtu.be', 'instagram.com', 'www.instagram.com', 'tiktok.com', 'www.tiktok.com']), 422, 'Use a YouTube, Instagram or TikTok video link.');
        // Store links only: never fetch arbitrary user-supplied URLs.
        $key = ['user_id' => $request->user()->id, 'url' => $data['url']];
        $existing = DB::table('inspirations')->where($key)->first();
        DB::table('inspirations')->updateOrInsert($key, $data + [
            'updated_at' => now(), 'created_at' => $existing?->created_at ?? now(),
        ]);

        return response()->json(DB::table('inspirations')->where($key)->first(), 201);
    }

    public function destroy(Request $request, int $id)
    {
        $deleted = DB::table('inspirations')->where('user_id', $request->user()->id)->where('id', $id)->delete();
        abort_unless($deleted, 404);

        return response()->noContent();
    }

    public function discover(Request $request)
    {
        $data = $request->validate(['channel' => ['nullable', 'regex:/^UC[a-zA-Z0-9_-]{22}$/']]);
        $channel = $data['channel'] ?? 'UCAuUUnT6oDeKwE6v1NGQxug';
        $result = Cache::remember("inspiration.feed.{$channel}", 300, function () use ($channel) {
            $response = Http::timeout(15)->withoutRedirecting()->get('https://www.youtube.com/feeds/videos.xml', ['channel_id' => $channel]);
            abort_unless($response->successful(), 502, 'This channel feed is unavailable. Try another channel ID.');
            $xml = simplexml_load_string($response->body(), \SimpleXMLElement::class, LIBXML_NONET);
            abort_unless($xml, 502, 'The channel returned an unreadable feed.');
            $xml->registerXPathNamespace('a', 'http://www.w3.org/2005/Atom');
            $items = [];
            foreach ($xml->xpath('//a:entry') as $entry) {
                $atom = $entry->children('http://www.w3.org/2005/Atom');
                $id = (string) $entry->children('http://www.youtube.com/xml/schemas/2015')->videoId;
                if (! preg_match('/^[a-zA-Z0-9_-]{11}$/', $id)) {
                    continue;
                }
                $url = (string) $atom->link->attributes()->href;
                $items[] = [
                    'title' => (string) $atom->title, 'creator' => (string) $atom->author->name,
                    'url' => str_contains($url, '/shorts/') ? "https://www.youtube.com/shorts/{$id}" : "https://www.youtube.com/watch?v={$id}",
                    'video_id' => $id, 'published_at' => (string) $atom->published,
                    'short' => str_contains($url, '/shorts/'),
                ];
            }
            return ['items' => $items, 'checked_at' => now()->toIso8601String(), 'channel' => $channel];
        });

        return response()->json($result);
    }
}
