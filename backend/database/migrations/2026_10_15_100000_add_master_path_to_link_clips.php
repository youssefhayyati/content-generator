<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** A highlight's clean master (the video without text), so its subtitles and music can be edited. */
    public function up(): void
    {
        Schema::table('link_clips', function (Blueprint $table) {
            $table->string('master_path')->nullable()->after('post_id');
        });
    }

    public function down(): void
    {
        Schema::table('link_clips', function (Blueprint $table) {
            $table->dropColumn('master_path');
        });
    }
};
