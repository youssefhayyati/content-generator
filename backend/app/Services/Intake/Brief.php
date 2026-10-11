<?php

namespace App\Services\Intake;

/**
 * What a campaign brief holds, in the order the interview covers it.
 *
 * `core` fields need an answer; the others are asked once. `question` and `options` are what the
 * standard question list asks when Claude isn't running the interview; Claude words its own.
 */
final class Brief
{
    public const GROUPS = [
        'basics' => 'Basics',
        'audience' => 'Audience',
        'story' => 'Story & relatability',
        'voice' => 'Voice',
        'look' => 'Look & photos',
        'content' => 'Content',
        'schedule' => 'Schedule',
        'budget' => 'Budget',
    ];

    public const FIELDS = [
        'focus' => ['group' => 'basics', 'label' => 'What we’re promoting', 'core' => true,
            'question' => 'Are we promoting you as a person, a product, or your business?',
            'options' => ['Me (personal brand)', 'A product', 'My business', 'Me and my product']],
        'business' => ['group' => 'basics', 'label' => 'Business / who you are', 'core' => true,
            'question' => 'Tell me about your business or what you do.', 'options' => []],
        'offer' => ['group' => 'basics', 'label' => 'Product or offer', 'core' => true,
            'question' => 'What exactly should this campaign promote?', 'options' => []],
        'usp' => ['group' => 'basics', 'label' => 'What makes it different', 'core' => true,
            'question' => 'What makes you or your product different from others?', 'options' => []],
        'goal' => ['group' => 'basics', 'label' => 'Main goal', 'core' => true,
            'question' => 'What’s the main goal?',
            'options' => ['More sales', 'More followers', 'Brand awareness', 'More leads']],
        'audience' => ['group' => 'audience', 'label' => 'Ideal customer', 'core' => true,
            'question' => 'Who is your ideal customer? Age, location, lifestyle.', 'options' => []],
        'pains' => ['group' => 'audience', 'label' => 'Their problems & wishes', 'core' => true,
            'question' => 'What problem or wish does your customer have that you solve?', 'options' => []],
        'competitors' => ['group' => 'audience', 'label' => 'Competitors & inspiration', 'core' => false,
            'question' => 'Any competitors or accounts whose content you like?', 'options' => ['None in mind']],
        'story' => ['group' => 'story', 'label' => 'Story to tell', 'core' => true,
            'question' => 'What’s the story behind you or your product? How did it start?', 'options' => []],
        'moments' => ['group' => 'story', 'label' => 'Real-life moments', 'core' => true,
            'question' => 'Describe a typical moment when someone uses your product or works with you.', 'options' => []],
        'proof' => ['group' => 'story', 'label' => 'Proof & results', 'core' => false,
            'question' => 'Any customer reviews, results, or numbers we can show?',
            'options' => ['Yes, some reviews', 'Not yet']],
        'faces' => ['group' => 'story', 'label' => 'Who appears in content', 'core' => true,
            'question' => 'Who should appear in the content?',
            'options' => ['Me, on camera', 'Product only', 'My team', 'Customers']],
        'tone' => ['group' => 'voice', 'label' => 'Brand tone', 'core' => true,
            'question' => 'How should the content sound?',
            'options' => ['Friendly & fun', 'Premium', 'Bold', 'Warm & trustworthy']],
        'wording' => ['group' => 'voice', 'label' => 'Words to use / avoid', 'core' => false,
            'question' => 'Any words, phrases, or topics we must use or avoid?', 'options' => ['Nothing special']],
        'language' => ['group' => 'voice', 'label' => 'Content language', 'core' => true,
            'question' => 'Which language should the content be in?',
            'options' => ['English', 'French', 'Arabic', 'Spanish']],
        'look' => ['group' => 'look', 'label' => 'Visual style & colors', 'core' => true,
            'question' => 'Describe your visual style and brand colors.',
            'options' => ['Clean & minimal', 'Bright & colorful', 'Dark & luxury', 'Natural & earthy']],
        'photos' => ['group' => 'look', 'label' => 'Reference photos', 'core' => true, 'photo' => true,
            'question' => 'Can you share your logo, and photos of your product and of the people who’ll appear? We’ll use them as references for AI visuals.',
            'options' => ['I’ll send them later']],
        'channels' => ['group' => 'content', 'label' => 'Channels', 'core' => true,
            'question' => 'Where should we post?', 'options' => ['Instagram', 'TikTok', 'Facebook', 'LinkedIn']],
        'formats' => ['group' => 'content', 'label' => 'Content formats', 'core' => true,
            'question' => 'Which content formats do you want?',
            'options' => ['Short videos / Reels', 'Photo posts', 'Carousels', 'Stories']],
        'cta' => ['group' => 'content', 'label' => 'Call to action', 'core' => true,
            'question' => 'What should people do after seeing a post?',
            'options' => ['Buy now', 'Send a DM', 'Visit website', 'Book a call']],
        'timing' => ['group' => 'schedule', 'label' => 'Start & duration', 'core' => true,
            'question' => 'When should the campaign start, and for how long?',
            'options' => ['Next week, 1 month', 'Next month, 3 months']],
        'rhythm' => ['group' => 'schedule', 'label' => 'Posting rhythm', 'core' => true,
            'question' => 'How often should we post, and on which days or times?',
            'options' => ['3 times a week', 'Every day', 'Not sure, suggest one']],
        'keydates' => ['group' => 'schedule', 'label' => 'Key dates', 'core' => false,
            'question' => 'Any launches, holidays, or events to plan around?', 'options' => ['None']],
        'approval' => ['group' => 'schedule', 'label' => 'Approval', 'core' => false,
            'question' => 'Who approves content before it goes live?',
            'options' => ['Me', 'My team', 'No approval needed']],
        'budget' => ['group' => 'budget', 'label' => 'Budget', 'core' => true,
            'question' => 'Roughly how much can you spend, including ads?',
            'options' => ['Under $500', '$500–2,000', '$2,000–10,000', 'Not sure']],
    ];

    /**
     * What each interview asks when the standard list runs it (5 or 10 questions). With AI, these
     * have to be covered too, but the interviewer picks its own questions to fit the client (two
     * fields in one question, a follow-up where it matters) and suggests everything it didn't ask.
     */
    public const QUICK = ['focus', 'offer', 'audience', 'goal', 'photos'];

    public const FULL = ['focus', 'offer', 'usp', 'goal', 'audience', 'pains', 'tone', 'look', 'photos', 'cta'];

    public const MAX_QUESTIONS = ['quick' => 5, 'full' => 10];

    public const MAX_PHOTOS = 12;

    /** Ends every value Claude made up rather than heard, whatever language the rest is in. */
    public const SUGGESTED = '(suggested)';

    /**
     * @return list<string>
     */
    public static function keys(): array
    {
        return array_keys(self::FIELDS);
    }

    /**
     * @return array<string, string>
     */
    public static function blank(): array
    {
        return array_fill_keys(self::keys(), '');
    }

    /**
     * The fields an interview of this depth has to cover before it can finish.
     *
     * @return list<string>
     */
    public static function needed(string $depth): array
    {
        return $depth === 'quick' ? self::QUICK : self::FULL;
    }

    public static function isSuggested(string $value): bool
    {
        return str_ends_with(trim($value), self::SUGGESTED);
    }
}
