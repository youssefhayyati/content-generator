<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** The adaptation's takes (angle, caption, hashtags), so the person can pick another after a reload. */
    public function up(): void
    {
        Schema::table('reposts', function (Blueprint $table) {
            $table->json('options')->nullable()->after('hashtags');
        });
    }

    public function down(): void
    {
        Schema::table('reposts', function (Blueprint $table) {
            $table->dropColumn('options');
        });
    }
};
