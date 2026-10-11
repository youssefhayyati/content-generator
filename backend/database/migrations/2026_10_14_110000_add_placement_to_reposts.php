<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Where a repost goes (feed, reel, story, post): picked with the link, it's adapted for that as soon as
     * it's read. And a story's line of text, drawn on the picture since stories show no caption.
     */
    public function up(): void
    {
        Schema::table('reposts', function (Blueprint $table) {
            $table->string('placement', 20)->nullable()->after('account_id');
            $table->string('story_text', 160)->nullable()->after('options');
        });
    }

    public function down(): void
    {
        Schema::table('reposts', function (Blueprint $table) {
            $table->dropColumn(['placement', 'story_text']);
        });
    }
};
