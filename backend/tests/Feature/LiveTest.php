<?php

namespace Tests\Feature;

use App\Enums\PostStatus;
use App\Models\Account;
use App\Models\Device;
use App\Models\Post;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Mission Control: the departures board says, in a word, where every post stands. */
class LiveTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_board_tells_each_posts_story_and_the_wall_sees_the_phones(): void
    {
        $user = User::factory()->create();
        $phone = Device::factory()->for($user)->create(['name' => 'Studio phone']);
        $ig = Account::factory()->for($user)->automated()->create(['platform' => 'instagram', 'handle' => 'maisoncire', 'device_id' => $phone->id]);
        $x = Account::factory()->for($user)->create(['platform' => 'x', 'handle' => 'cire_lyon']);
        $make = fn (Account $a, array $attrs) => Post::factory()->for($user)->for($a)->create(['platforms' => [$a->platform->value], ...$attrs]);

        $boarding = $make($ig, ['status' => PostStatus::Scheduled, 'scheduled_at' => now()->addMinutes(9), 'approved_at' => now()]);
        $onTime = $make($ig, ['status' => PostStatus::Scheduled, 'scheduled_at' => now()->addHours(5), 'approved_at' => now()->subHour()]);
        $waiting = $make($ig, ['status' => PostStatus::Scheduled, 'scheduled_at' => now()->addHours(6)]);
        $live = $make($x, ['status' => PostStatus::Published, 'scheduled_at' => now()->subHour(), 'published_at' => now()->subHour()]);
        $failed = $make($x, ['status' => PostStatus::Failed, 'scheduled_at' => now()->subHours(2)]);
        $byHand = $make($x, ['status' => PostStatus::Scheduled, 'scheduled_at' => now()->subMinutes(20), 'approved_at' => now()->subDay()]);
        $far = $make($ig, ['status' => PostStatus::Scheduled, 'scheduled_at' => now()->addDays(5), 'approved_at' => now()]);

        $board = collect($this->spa()->actingAs($user)->getJson('/api/live')->assertOk()->json('departures'))->pluck('status', 'id');
        $this->assertSame('boarding', $board[$boarding->id]);
        $this->assertSame('on_time', $board[$onTime->id]);
        $this->assertSame('waiting', $board[$waiting->id]);
        $this->assertSame('live', $board[$live->id]);
        $this->assertSame('needs_you', $board[$failed->id]);
        $this->assertSame('by_hand', $board[$byHand->id], 'Its time passed and no phone posts for that account.');
        $this->assertArrayNotHasKey($far->id, $board->all(), 'The board shows the next two days.');

        // A storm holds what was approved before it.
        $ig->update(['storm_at' => now()]);
        $this->assertSame('held', collect($this->spa()->actingAs($user)->getJson('/api/live')->json('departures'))->firstWhere('id', $onTime->id)['status']);

        $wall = $this->spa()->actingAs($user)->getJson('/api/live')->json();
        $this->assertSame(['Studio phone'], array_column($wall['phones'], 'name'));
        $this->assertSame(['maisoncire', 'cire_lyon'], array_column($wall['weather'], 'handle'));
        $this->assertSame(1, $wall['today']['published']);

        $this->spa()->actingAs(User::factory()->create())->getJson('/api/live')->assertOk()->assertJsonCount(0, 'departures');
    }
}
