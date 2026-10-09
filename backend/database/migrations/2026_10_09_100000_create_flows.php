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
        // Flows: automations the operator draws (or describes) once. A trigger starts a run;
        // the run walks the graph node by node, waits where it's told to, and stops at a
        // person whenever a post is about to be scheduled.
        Schema::create('flows', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('description', 300)->nullable();
            $table->boolean('enabled')->default(false);
            // {nodes: [{id, type, x, y, config}], edges: [{from, to, port}]}
            $table->json('graph');
            // The trigger node's type, kept beside the graph so events find their flows fast.
            $table->string('trigger', 40);
            $table->string('template', 40)->nullable();
            $table->timestamp('next_run_at')->nullable(); // schedule triggers
            $table->timestamp('polled_at')->nullable(); // feed triggers
            $table->json('state')->nullable(); // what the trigger remembers, e.g. feed items already seen
            $table->timestamps();

            $table->index(['trigger', 'enabled']);
        });

        Schema::create('flow_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('flow_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // running | waiting (a timer) | approval (a person) | done | failed | stopped
            $table->string('status', 20)->default('running');
            $table->string('cause', 200)->nullable(); // one line: what started it
            $table->json('context')->nullable(); // the run's variables: {post: {...}, draft: "...", score: 82}
            $table->json('pending')->nullable(); // node ids still to run, next first
            $table->json('trail')->nullable(); // [{node, type, status, port, summary, ms, at}]
            $table->string('waiting_on', 40)->nullable(); // the node a wait or an approval is holding at
            $table->timestamp('resume_at')->nullable();
            $table->text('error')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'resume_at']);
            $table->index(['flow_id', 'id']);
        });

        // Notes a flow (or the system) leaves in the Inbox until someone dismisses them.
        Schema::create('inbox_notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('flow_run_id')->nullable()->constrained()->nullOnDelete();
            $table->string('title', 200);
            $table->text('detail')->nullable();
            $table->string('tone', 10)->default('plan');
            $table->string('link', 300)->nullable();
            $table->timestamp('dismissed_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'dismissed_at']);
        });

        // Storm Guard: when an account's comments turn, its publishing holds by itself.
        Schema::table('accounts', function (Blueprint $table) {
            $table->json('storm_guard')->nullable(); // {enabled, window_minutes, min_comments, threshold}
            $table->timestamp('storm_at')->nullable(); // tripped: nothing publishes on this account
            $table->string('storm_reason', 300)->nullable();
        });

        Schema::table('comments', function (Blueprint $table) {
            // -100 (furious) … 100 (delighted): read on arrival, refined by AI triage.
            $table->smallInteger('sentiment')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('comments', fn (Blueprint $table) => $table->dropColumn('sentiment'));
        Schema::table('accounts', fn (Blueprint $table) => $table->dropColumn(['storm_guard', 'storm_at', 'storm_reason']));
        Schema::dropIfExists('inbox_notes');
        Schema::dropIfExists('flow_runs');
        Schema::dropIfExists('flows');
    }
};
