<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who posts it from the phone: your own agent (direct), the phone's agent (agent), or the phone's agent
 * with yours taking over if it fails (auto). Empty: whatever the Assistant page's switch says.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('posts', function (Blueprint $table) {
            $table->string('phone_driver', 12)->nullable()->after('device_id');
        });
    }

    public function down(): void
    {
        Schema::table('posts', function (Blueprint $table) {
            $table->dropColumn('phone_driver');
        });
    }
};
