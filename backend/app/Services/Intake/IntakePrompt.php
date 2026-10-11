<?php

namespace App\Services\Intake;

use App\Models\Campaign;
use App\Models\CampaignPhoto;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

/**
 * What Claude is told during a campaign intake: each interview turn, reading reference photos,
 * and writing the content kit.
 */
final class IntakePrompt
{
    /* ------------------------------------------------------------------ */
    /* Interview */
    /* ------------------------------------------------------------------ */

    public static function interviewSystem(): string
    {
        $fields = collect(Brief::FIELDS)
            ->map(fn (array $f, string $key) => "- {$key}: ".str_replace('’', "'", $f['label']).($f['core'] ? '' : ' (optional: ask once, record "None" if nothing)'))
            ->join("\n");
        $suggested = ' '.Brief::SUGGESTED;

        return <<<TXT
            You are the account strategist at a marketing agency, running an intake interview with a new client. The agency will later use AI to generate social media content, captions and images for this client, using photos the client shares as visual references. Your job: collect everything needed to create content that feels personal, specific and relatable, plus the posting schedule.

            Brief fields:
            {$fields}

            Each turn you get the brief so far, the photos shared, and the interview so far. Reply with the whole brief, updated, and your next question.

            Rules:
            - You have a fixed number of questions (below). Spend them on what matters most for THIS client and what they want to make: what they promote decides what you ask next. Everything you don't ask about, you suggest at the end.
            - Ask ONE short, friendly question at a time (max 20 words, everyday words, no marketing jargon). You may cover two closely related fields in one question.
            - Never ask about something already answered. Fill fields from everything the client said, including details given early. Keep each value short (max 15 words) but concrete: keep names, places, numbers, and real details.
            - Adapt to what's being promoted. Personal brand: ask about their personality, expertise, daily life, values, and being on camera. Product: ask about how it's used, how it feels, who uses it, where, and the moment it helps. Business: the people behind it and customer experiences.
            - Go after relatable material: real stories, everyday moments, customer situations, the "why". If an answer is vague, ask one follow-up to get a specific detail, then move on.
            - For "photos": ask the client to share what the visuals should be built on, fitted to them: their logo, photos of the product or objects, and of the people who'll appear (themselves, their team). Set "photo_request" to true for that question. Only fill the photos field yourself if the client says they will send them later or have none.
            - For "language": fill it without asking if the client clearly writes in one language and nothing suggests otherwise; otherwise ask.
            - If the client doesn't know, propose a sensible default for them and record it.
            - Any value you invent rather than hear from the client must end with the exact English marker "{$suggested}", even when the rest is in another language.
            - "options": 2-4 short tap-able answer suggestions (max 5 words each) fitted to THIS client. Use an empty list for open questions where they should describe something in their own words.
            - "topic": the key of the field your question is mainly about.
            - Write the question, options and field values in the language of the client's own messages (not the language of a place or a name they mention). Until they've written a sentence, use the language of the interview so far.
            TXT;
    }

    public static function interview(Campaign $campaign, bool $finishNow = false): string
    {
        $fields = json_encode($campaign->fields, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $max = Brief::MAX_QUESTIONS[$campaign->depth] ?? Brief::MAX_QUESTIONS['full'];
        $suggested = ' '.Brief::SUGGESTED;

        $rules = ($campaign->depth === 'quick'
            ? "- QUICK MODE: {$max} questions in total, no more. They must cover at least: ".implode(', ', Brief::QUICK).'. Combine related ones into one question. No follow-up questions.'
            : "- THOROUGH MODE: {$max} questions in total, no more. They must cover at least: ".implode(', ', Brief::FULL).'. Combine related ones where it helps, and spend a question on a follow-up only when an answer is too vague to make content from.')."\n"
            .'- When those fields are covered or the questions are used up, set "done" to true and fill EVERY other empty field with a sensible, specific suggestion (with the "'.trim($suggested).'" marker) based on everything you know about this client.';

        if ($finishNow) {
            $rules .= "\n- THE CLIENT ASKED TO FINISH NOW. Do not ask anything. Fill every empty field with a sensible, specific suggestion (with the \"{$suggested}\" marker), set \"question\" to \"\" and \"done\" to true.";
        }

        $photos = $campaign->photos->isNotEmpty() ? "\nPhotos already shared:\n".self::photoLines($campaign->photos)."\n" : '';
        $transcript = self::transcript($campaign);

        return <<<TXT
            {$rules}

            Current brief:
            {$fields}
            {$photos}
            Interview so far:
            {$transcript}

            Questions asked so far: {$campaign->asked}.
            TXT;
    }

    /**
     * @return array<string, mixed>
     */
    public static function interviewSchema(): array
    {
        $keys = Brief::keys();

        return [
            'type' => 'object',
            'properties' => [
                'fields' => [
                    'type' => 'object',
                    'properties' => array_fill_keys($keys, ['type' => 'string']),
                    'required' => $keys,
                    'additionalProperties' => false,
                ],
                'question' => ['type' => 'string', 'description' => 'The next question, or "" when the interview is done.'],
                'options' => ['type' => 'array', 'items' => ['type' => 'string']],
                'topic' => ['type' => 'string', 'enum' => [...$keys, '']],
                'photo_request' => ['type' => 'boolean'],
                'done' => ['type' => 'boolean'],
            ],
            'required' => ['fields', 'question', 'options', 'topic', 'photo_request', 'done'],
            'additionalProperties' => false,
        ];
    }

    /* ------------------------------------------------------------------ */
    /* Reference photos */
    /* ------------------------------------------------------------------ */

    public static function photosSystem(): string
    {
        return <<<'TXT'
            A client sent reference photos to their marketing agency. The agency will use them as references for AI-generated social media images and videos. For each image, describe exactly what is visible so an image generator can reproduce the subject faithfully: subject, appearance (for people: hair, build, clothing, expression; for products: shape, materials, colors, packaging, labels; for a logo: the mark, its lettering, its colours), lighting, background, mood.

            For each photo, in order: its kind, a 2-4 word title, and a 1-2 sentence description.
            TXT;
    }

    /**
     * The photos as image blocks, each labelled, then what the client is promoting.
     *
     * @param  Collection<int, CampaignPhoto>  $photos
     * @return list<array<string, mixed>>
     */
    public static function photos(Campaign $campaign, Collection $photos): array
    {
        $blocks = [];
        foreach ($photos->values() as $i => $photo) {
            $blocks[] = ['type' => 'text', 'text' => 'Photo '.($i + 1).':'];
            $blocks[] = ['type' => 'image', 'source' => [
                'type' => 'base64',
                'mediaType' => $photo->mime,
                'data' => base64_encode(Storage::disk('local')->get($photo->path)),
            ]];
        }

        $f = fn (string $key) => ($campaign->fields[$key] ?? '') ?: '?';
        $language = ($campaign->fields['language'] ?? '')
            ? 'Write titles and descriptions in '.$campaign->fields['language'].'.'
            : 'Write titles and descriptions in the language of the client context above.';
        $blocks[] = ['type' => 'text', 'text' => 'Client context: promoting '.$f('focus').'; business: '.$f('business').'; offer: '.$f('offer').".\n"
            .'Describe the '.$photos->count().' photo(s) above, in order. '.$language];

        return $blocks;
    }

    /**
     * @return array<string, mixed>
     */
    public static function photosSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'photos' => [
                    'type' => 'array',
                    'items' => [
                        'type' => 'object',
                        'properties' => [
                            'kind' => ['type' => 'string', 'enum' => CampaignPhoto::KINDS],
                            'title' => ['type' => 'string'],
                            'description' => ['type' => 'string'],
                        ],
                        'required' => ['kind', 'title', 'description'],
                        'additionalProperties' => false,
                    ],
                ],
            ],
            'required' => ['photos'],
            'additionalProperties' => false,
        ];
    }

    /* ------------------------------------------------------------------ */
    /* Content kit */
    /* ------------------------------------------------------------------ */

    public static function kitSystem(): string
    {
        return <<<'TXT'
            You are a senior content strategist at a marketing agency. Using a client brief, you create a content kit the agency can use right away to generate posts with AI.

            Write these sections, each starting with "## ":
            ## Brand snapshot (who they are, voice in 3 words, audience in one line, what makes them different)
            ## Content pillars (3-4 pillars; for each, why it's relatable to this audience)
            ## Relatable hooks (8 scroll-stopping opening lines built on their real story, everyday moments and customer problems)
            ## Posting schedule (a markdown table for the first 2 weeks: Day | Platform | Format | Topic | Pillar; respect their posting rhythm, channels, start date and key dates)
            ## Ready-to-make posts (6 posts: hook, caption draft with CTA, visual idea)
            ## AI image & video prompts (6 detailed prompts for an image generator; when a photo fits, start with "Reference: Photo N" and say what to keep identical, such as the person's face or the product's exact look, and what to change: setting, outfit, lighting, angle)
            ## Hashtags & CTA (hashtag set per channel, CTA lines)
            ## Measuring success (3-4 KPIs with targets)
            ## Still missing (anything the agency should collect or confirm with the client before producing, including every brief value marked "(suggested)", since those are AI guesses)

            Use "- " for bullets and **bold** sparingly. Be specific to this client, never generic. No intro or outro text. Write in the content language from the brief.
            TXT;
    }

    public static function kit(Campaign $campaign): string
    {
        $photos = $campaign->photos->isNotEmpty()
            ? "Reference photos (refer to them by these names):\n".self::photoLines($campaign->photos)
            : 'No reference photos yet: write image prompts that describe the subject from the brief, and mark them [needs client photo].';

        return self::markdown($campaign)."\n{$photos}\n\nInterview notes:\n".self::transcript($campaign)
            ."\n\nToday is ".now($campaign->user->timezoneOrUtc())->format('l j F Y').'.';
    }

    /* ------------------------------------------------------------------ */
    /* Shared */
    /* ------------------------------------------------------------------ */

    /**
     * The brief as Markdown: what the kit is written from, and what "Copy brief" copies.
     */
    public static function markdown(Campaign $campaign): string
    {
        $out = "# Client brief\n";
        foreach (Brief::GROUPS as $group => $label) {
            $out .= "\n## {$label}\n";
            foreach (Brief::FIELDS as $key => $field) {
                if ($field['group'] === $group) {
                    $out .= "- **{$field['label']}:** ".($campaign->value($key) ?: '—')."\n";
                }
            }
        }

        if ($campaign->photos->isNotEmpty()) {
            $out .= "\n## Reference photos\n".self::photoLines($campaign->photos)."\n";
        }

        return $out;
    }

    /**
     * @param  Collection<int, CampaignPhoto>  $photos
     */
    private static function photoLines(Collection $photos): string
    {
        return $photos->values()
            ->map(fn (CampaignPhoto $p, int $i) => 'Photo '.($i + 1).($p->kind ? " ({$p->kind})" : '').': '.($p->description ?: 'no description'))
            ->join("\n");
    }

    /**
     * The interview as Claude reads it: who said what, with shared photos spelled out.
     */
    private static function transcript(Campaign $campaign): string
    {
        $photos = $campaign->photos->keyBy('id');

        return collect($campaign->messages)
            ->reject(fn (array $m) => $m['who'] === 'note')
            ->map(function (array $m) use ($photos) {
                if ($m['who'] === 'agency') {
                    return 'Strategist: '.$m['text'];
                }
                if (! empty($m['photos'])) {
                    $shared = collect($m['photos'])->map(fn (int $id) => $photos->get($id))->filter()
                        ->map(fn (CampaignPhoto $p) => ($p->kind ?: 'photo').($p->description ? ' — '.$p->description : ''));

                    return 'Client: [Shared '.count($m['photos']).' photo(s)'.($shared->isNotEmpty() ? ': '.$shared->join('; ') : '').']';
                }

                return 'Client: '.$m['text'];
            })
            ->join("\n");
    }
}
