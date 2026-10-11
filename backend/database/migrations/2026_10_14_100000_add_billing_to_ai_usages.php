<?php

use App\Models\Generation;
use App\Services\Ai\Pricing;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Each model call says how its cost is known (billed by a provider, estimated from pod time,
     * free, or unpriced), and how long a pod job held the GPU.
     */
    public function up(): void
    {
        Schema::table('ai_usages', function (Blueprint $table) {
            $table->string('billing', 16)->default('billed')->after('cost');
            $table->unsignedInteger('seconds')->default(0)->after('billing');
        });

        // Rows from before: anything that cost nothing was free, except the pod's, which ran unpriced.
        DB::table('ai_usages')->whereNotIn('provider', ['pod', 'voicestudio'])->where('cost', 0)->update(['billing' => 'free']);
        DB::table('ai_usages')->whereIn('provider', ['pod', 'voicestudio'])->update(['billing' => 'estimated']);

        // Text calls kept their tokens: priced again, now that more models have a price (GLM on Ollama Cloud).
        DB::table('ai_usages')->where('billing', 'free')->where(fn ($q) => $q->where('input_tokens', '>', 0)->orWhere('output_tokens', '>', 0))
            ->orderBy('id')->each(function ($row) {
                $priced = Pricing::tokens($row->provider, $row->model, $row->input_tokens, $row->output_tokens);
                DB::table('ai_usages')->where('id', $row->id)->update($priced);
            });

        // Their generations say how long each took: priced at the pod's rate now.
        $hourly = (float) config('ai.providers.pod.hourly', 0);
        DB::table('ai_usages')->join('generations', 'generations.id', '=', 'ai_usages.context_id')
            ->whereIn('ai_usages.provider', ['pod', 'voicestudio'])->where('ai_usages.context_type', (new Generation)->getMorphClass())
            ->whereNotNull('generations.started_at')->whereNotNull('generations.finished_at')
            ->select('ai_usages.id', 'generations.started_at', 'generations.finished_at')->orderBy('ai_usages.id')
            ->each(function ($row) use ($hourly) {
                $seconds = max(0, Carbon::parse($row->finished_at)->diffInSeconds(Carbon::parse($row->started_at), true));
                DB::table('ai_usages')->where('id', $row->id)->update(['seconds' => (int) round($seconds), 'cost' => round($seconds / 3600 * $hourly, 6)]);
            });
    }

    public function down(): void
    {
        Schema::table('ai_usages', function (Blueprint $table) {
            $table->dropColumn(['billing', 'seconds']);
        });
    }
};
