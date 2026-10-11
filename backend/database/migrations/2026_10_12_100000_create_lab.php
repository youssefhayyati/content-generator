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
        // Creative Lab: a project's canvas is a graph of nodes (projects.canvas, version 2). Every
        // time a node runs it leaves a run: its inputs, its settings and what it made. The runs are
        // the node's history; the newest good one is what flows on, unless a person pinned another.
        Schema::create('node_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->string('node_id', 40);
            $table->string('type', 60);
            $table->unsignedInteger('version')->default(1);
            // queued | running | succeeded | failed | canceled
            $table->string('status', 20)->default('queued');
            // What it ran with, hashed: a node whose inputs or settings no longer hash the same is out of date.
            $table->string('inputs_hash', 64);
            $table->json('params')->nullable();
            $table->json('inputs')->nullable(); // per port: asset ids, text, brief... as they were
            $table->json('outputs')->nullable(); // per port: {type, assets|text|brief|moments|...}
            $table->json('state')->nullable(); // the executor's own bookkeeping while it waits
            $table->string('stage', 160)->nullable(); // where it has got, in a few words
            $table->decimal('share', 4, 3)->nullable(); // how much is done, 0..1, when known
            $table->text('error')->nullable();
            $table->decimal('cost', 10, 4)->default(0);
            $table->string('by', 20)->default('you'); // you | assistant | auto
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['project_id', 'node_id']);
            $table->index(['status', 'updated_at']);
        });

        // A model call made for a node waits on its generation; finishing it moves the node on.
        Schema::table('generations', function (Blueprint $table) {
            $table->foreignId('node_run_id')->nullable()->constrained()->nullOnDelete();
        });

        // Where a post came from (its Post node), and the phone it goes out on when not the account's own.
        Schema::table('posts', function (Blueprint $table) {
            $table->foreignId('project_id')->nullable()->constrained()->nullOnDelete();
            $table->string('node_id', 40)->nullable();
            $table->foreignId('device_id')->nullable()->constrained()->nullOnDelete();
            // How it's doing once live, as the phone last read it: {likes, comments, shares, saves, views, latest_comments}
            $table->json('metrics')->nullable();
            $table->timestamp('metrics_at')->nullable();
        });

        // A video from YouTube (or another site yt-dlp reads), and the permission to use it. Nothing is
        // downloaded until a person has recorded whose video it is and why we may use it.
        Schema::create('video_sources', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('url', 500);
            $table->string('site', 40)->default('youtube');
            $table->string('external_id', 64)->nullable();
            $table->string('title', 300)->nullable();
            $table->string('channel', 200)->nullable();
            $table->string('channel_url', 500)->nullable();
            $table->decimal('duration', 10, 2)->nullable();
            $table->string('license', 120)->nullable();
            $table->string('thumbnail', 500)->nullable();
            // pending | allowed | denied, and why: own (my channel) | permission | creative_commons
            $table->string('permission', 20)->default('pending');
            $table->string('basis', 30)->nullable();
            $table->string('permission_note', 500)->nullable();
            $table->string('credit', 300)->nullable(); // the line every caption made from it carries
            $table->timestamp('permission_at')->nullable();
            // new | fetching | ready | failed
            $table->string('status', 20)->default('new');
            $table->foreignId('audio_asset_id')->nullable()->constrained('assets')->nullOnDelete();
            $table->foreignId('video_asset_id')->nullable()->constrained('assets')->nullOnDelete();
            $table->json('transcript')->nullable();
            $table->json('meta')->nullable(); // chapters, heatmap, captions found...
            $table->text('error')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'external_id']);
        });

        // A graph worth starting from again: the user's own templates (the built-in ones live in code).
        Schema::create('lab_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 80);
            $table->string('description', 300)->nullable();
            $table->string('category', 40)->default('mine');
            $table->json('graph');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('lab_templates');
        Schema::dropIfExists('video_sources');
        Schema::table('posts', function (Blueprint $table) {
            $table->dropConstrainedForeignId('device_id');
            $table->dropConstrainedForeignId('project_id');
            $table->dropColumn(['node_id', 'metrics', 'metrics_at']);
        });
        Schema::table('generations', fn (Blueprint $table) => $table->dropConstrainedForeignId('node_run_id'));
        Schema::dropIfExists('node_runs');
    }
};
