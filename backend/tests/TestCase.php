<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Storage;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // Model hooks delete files when records are deleted; without a fake disk a test
        // that deletes a user or campaign wipes real media off the real storage.
        Storage::fake('local');
    }

    /**
     * Send the request the way the React app does, so Sanctum treats it as stateful
     * and gives it a session.
     */
    protected function spa(): static
    {
        return $this->withHeaders([
            'Referer' => 'http://localhost:5173/',
            'Accept' => 'application/json',
        ]);
    }
}
