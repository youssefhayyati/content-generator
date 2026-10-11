<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A campaign photo's copy in the gallery, made the first time a Creative Lab project starts from the
 * campaign: its Media nodes (logo, product, people) use it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('campaign_photos', function (Blueprint $table) {
            $table->foreignId('asset_id')->nullable()->after('campaign_id')->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('campaign_photos', function (Blueprint $table) {
            $table->dropConstrainedForeignId('asset_id');
        });
    }
};
