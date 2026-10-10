<?php

namespace App\Services\Clips;

use App\Services\Flows\SafeUrl;
use DOMDocument;
use DOMXPath;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

/** Fetch the readable facts from a public article without allowing calls into the studio network. */
class ArticleReader
{
    /** @return array{title: string, description: string, text: string, image: string|null} */
    public function read(string $url): array
    {
        if ($problem = SafeUrl::problem($url)) {
            throw new RuntimeException($problem);
        }

        $response = Http::timeout(25)
            ->withOptions(['allow_redirects' => false])
            ->withHeaders(['User-Agent' => 'FlowAI Clip Studio/1.0'])
            ->get($url);
        if ($response->redirect()) {
            throw new RuntimeException('That article redirects somewhere else. Paste its final URL and try again.');
        }
        if (! $response->successful()) {
            throw new RuntimeException("The article could not be opened ({$response->status()}).");
        }
        if (! str_contains(strtolower((string) $response->header('Content-Type')), 'text/html')) {
            throw new RuntimeException('That link is not an HTML article.');
        }
        $html = $response->body();
        if (strlen($html) > 3_000_000) {
            throw new RuntimeException('That article page is too large to read safely.');
        }

        $dom = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $ok = $dom->loadHTML($html, LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        if (! $ok) {
            throw new RuntimeException('The article page could not be read.');
        }
        $xpath = new DOMXPath($dom);
        $meta = function (string $key) use ($xpath): string {
            $query = "//meta[@property='{$key}' or @name='{$key}']/@content";

            return trim((string) ($xpath->query($query)?->item(0)?->nodeValue ?? ''));
        };
        $title = $meta('og:title') ?: trim((string) ($xpath->query('//h1')?->item(0)?->textContent ?? $xpath->query('//title')?->item(0)?->textContent ?? ''));
        $description = $meta('og:description') ?: $meta('description');

        foreach (['script', 'style', 'nav', 'footer', 'header', 'aside', 'form', 'noscript'] as $tag) {
            foreach (iterator_to_array($xpath->query("//{$tag}") ?: []) as $node) {
                $node->parentNode?->removeChild($node);
            }
        }
        $paragraphs = [];
        foreach ($xpath->query('//article//p | //main//p | //p') ?: [] as $node) {
            $text = trim(preg_replace('/\s+/u', ' ', (string) $node->textContent) ?? '');
            if (mb_strlen($text) >= 45 && ! in_array($text, $paragraphs, true)) {
                $paragraphs[] = $text;
            }
            if (mb_strlen(implode("\n\n", $paragraphs)) >= 18_000) {
                break;
            }
        }
        $text = Str::limit(implode("\n\n", $paragraphs), 18_000, '');
        if (! filled($title) || mb_strlen($text) < 120) {
            throw new RuntimeException('There was not enough readable article text at that link.');
        }

        return [
            'title' => Str::limit($title, 180, ''),
            'description' => Str::limit($description, 500, ''),
            'text' => $text,
            'image' => $this->absolute($url, $meta('og:image')),
        ];
    }

    private function absolute(string $page, string $candidate): ?string
    {
        if (! filled($candidate)) {
            return null;
        }
        if (str_starts_with($candidate, '//')) {
            $candidate = (parse_url($page, PHP_URL_SCHEME) ?: 'https').':'.$candidate;
        } elseif (! parse_url($candidate, PHP_URL_SCHEME)) {
            $parts = parse_url($page);
            $root = ($parts['scheme'] ?? 'https').'://'.($parts['host'] ?? '');
            $base = str_starts_with($candidate, '/') ? $root : $root.rtrim(dirname($parts['path'] ?? '/'), '/').'/';
            $candidate = $base.$candidate;
        }

        return SafeUrl::problem($candidate) ? null : $candidate;
    }
}
