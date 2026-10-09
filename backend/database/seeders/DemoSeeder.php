<?php

namespace Database\Seeders;

use App\Models\Account;
use App\Models\Asset;
use App\Models\User;
use App\Services\Media\AssetStore;
use Illuminate\Database\Seeder;

/**
 * The keyless demo: a user, two HTTP phones for the publishing agents, an Instagram and an X
 * account wired to them, and two photos in the library. Everything runs on the local Ollama
 * model and the publishing-studio simulator — no API keys, no hardware.
 *
 *   php artisan db:seed --class=DemoSeeder
 */
class DemoSeeder extends Seeder
{
    public function run(): void
    {
        $user = User::firstOrCreate(
            ['email' => 'demo@flowai.test'],
            ['name' => 'Demo', 'password' => bcrypt('password'), 'email_verified_at' => now()],
        );
        if (! $user->agent_token) {
            $user->forceFill(['agent_token' => 'demo-agent-token'])->save();
        }

        $igPhone = $user->devices()->updateOrCreate(['ref' => 'ig-phone'], ['name' => 'Instagram phone', 'driver' => 'http', 'profile' => 'reliable']);
        $xPhone = $user->devices()->updateOrCreate(['ref' => 'x-phone'], ['name' => 'X phone', 'driver' => 'http', 'profile' => 'reliable']);
        $user->accounts()->updateOrCreate(['platform' => 'instagram', 'handle' => 'maisoncire'], ['name' => 'Maison Cire', 'automation' => true, 'device_id' => $igPhone->id, 'min_gap_minutes' => 30]);
        $user->accounts()->updateOrCreate(['platform' => 'x', 'handle' => 'maisoncire'], ['name' => 'Maison Cire', 'automation' => true, 'device_id' => $xPhone->id, 'min_gap_minutes' => 30]);

        $this->photo($user, 'The autumn pour', 1080, 1350, [170, 110, 55]);
        $this->photo($user, 'Lavender & fig', 1600, 900, [90, 70, 110]);

        $this->command->info('Demo ready: demo@flowai.test / password · agent token "demo-agent-token" · phones ig-phone, x-phone');
    }

    /** A labeled gradient, so media posts have something real to carry. */
    private function photo(User $user, string $label, int $w, int $h, array $rgb): Asset
    {
        $im = imagecreatetruecolor($w, $h);
        for ($y = 0; $y < $h; $y++) {
            $c = imagecolorallocate($im, max(0, $rgb[0] - intdiv($y, 12)), max(0, $rgb[1] - intdiv($y, 18)), max(0, $rgb[2] - intdiv($y, 24)));
            imageline($im, 0, $y, $w, $y, $c);
        }
        $white = imagecolorallocate($im, 245, 242, 235);
        imagestring($im, 5, 60, $h - 140, $label, $white);
        imagestring($im, 3, 60, $h - 100, 'Maison Cire · autumn atelier', $white);
        ob_start();
        imagepng($im);
        $png = (string) ob_get_clean();
        imagedestroy($im);

        return app(AssetStore::class)->fromContents($user, $png, 'image/png', $label.'.png', 'upload');
    }
}
