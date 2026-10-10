<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trend_searches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('platform', 20);
            $table->string('hashtag', 60);
            $table->json('items');
            $table->unsignedInteger('results')->default(0);
            $table->decimal('cost', 8, 4)->default(0);
            $table->timestamps();
            // One row per hashtag, rewritten on each search, so history cannot grow without bound.
            $table->unique(['user_id', 'platform', 'hashtag']);
            $table->index(['user_id', 'platform', 'updated_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trend_searches');
    }
};
