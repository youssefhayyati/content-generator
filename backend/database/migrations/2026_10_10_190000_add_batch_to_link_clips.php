<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('link_clips', function (Blueprint $table) {
            $table->uuid('batch_id')->nullable()->after('user_id')->index();
            $table->unsignedSmallInteger('batch_index')->default(1)->after('batch_id');
            $table->unsignedSmallInteger('batch_total')->default(1)->after('batch_index');
        });
    }

    public function down(): void
    {
        Schema::table('link_clips', function (Blueprint $table) {
            $table->dropIndex(['batch_id']);
            $table->dropColumn(['batch_id', 'batch_index', 'batch_total']);
        });
    }
};
