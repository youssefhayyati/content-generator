<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Reposts go both ways now (X → Instagram and Instagram → X), and carry the source's media.
        Schema::table('reposts', function (Blueprint $table) {
            $table->string('source_platform', 20)->default('x')->after('account_id'); // where the post came from: x | instagram
            $table->json('asset_ids')->nullable()->after('source_text'); // the source's photos/video, saved to the library
            $table->string('error', 500)->nullable()->after('status'); // why fetching the source failed
            // status gains: fetching (reading the source) | failed (couldn't read it)
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('reposts', function (Blueprint $table) {
            $table->dropColumn(['source_platform', 'asset_ids', 'error']);
        });
    }
};
