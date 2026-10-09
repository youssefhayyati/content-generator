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
        // An account's sound: the voice it speaks in, its signature music mood, its accent colour
        // for reels. {voice, speed, mood, accent}
        Schema::table('accounts', function (Blueprint $table) {
            $table->json('sound')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('accounts', fn (Blueprint $table) => $table->dropColumn('sound'));
    }
};
