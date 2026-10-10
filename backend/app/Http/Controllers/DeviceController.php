<?php

namespace App\Http\Controllers;

use App\Http\Resources\DeviceResource;
use App\Models\ActionLog;
use App\Models\Device;
use App\Services\Publishing\Adb;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use RuntimeException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * The phones that publish: the built-in simulator, or phones on the phone-control service.
 */
class DeviceController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        return DeviceResource::collection($request->user()->devices()->with('accounts')->orderBy('name')->get());
    }

    /**
     * The phones plugged into the machine right now, each marked with the registered
     * phone it already is (if any). Registered phones that answer count as seen.
     */
    public function scan(Request $request, Adb $adb): JsonResponse
    {
        try {
            $found = $adb->devices();
        } catch (RuntimeException $e) {
            return response()->json(['available' => false, 'error' => $e->getMessage(), 'phones' => []]);
        }

        $registered = $request->user()->devices()->where('driver', 'http')->whereIn('ref', array_column($found, 'serial'))->get()->keyBy('ref');
        $ready = array_column(array_filter($found, fn ($p) => $p['state'] === 'device'), 'serial');
        $online = $registered->filter(fn (Device $d) => in_array($d->ref, $ready, true));
        if ($online->isNotEmpty()) {
            $request->user()->devices()->whereKey($online->modelKeys())->update(['last_seen_at' => now()]);
        }

        return response()->json([
            'available' => true,
            'error' => null,
            'phones' => array_map(fn (array $p) => $p + [
                'name' => trim(($p['manufacturer'] && ! str_starts_with((string) $p['model'], $p['manufacturer']) ? $p['manufacturer'].' ' : '').($p['model'] ?? $p['serial'])),
                'device_id' => $registered->get($p['serial'])?->id,
            ], $found),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $device = $request->user()->devices()->create($this->validated($request));
        ActionLog::record($request->user(), 'you', 'device.created', $device, "Added the phone “{$device->name}”.");

        return DeviceResource::make($device->load('accounts'))->response()->setStatusCode(201);
    }

    public function update(Request $request, Device $device): DeviceResource
    {
        Gate::authorize('update', $device);

        $device->update($this->validated($request, $device));

        return DeviceResource::make($device->load('accounts'));
    }

    /** Its accounts stay, unlinked; its past runs keep their records. */
    public function destroy(Request $request, Device $device): Response
    {
        Gate::authorize('delete', $device);
        abort_if($device->booked_run_id !== null, 409, 'This phone is running a job. Stop it first.');

        ActionLog::record($request->user(), 'you', 'device.deleted', $device, "Removed the phone “{$device->name}”.");
        $device->delete();

        return response()->noContent();
    }

    /** A paused phone starts nothing new; the run already on it still finishes. */
    public function pause(Request $request, Device $device): DeviceResource
    {
        Gate::authorize('update', $device);
        $device->update(['paused_at' => now()]);
        ActionLog::record($request->user(), 'you', 'device.paused', $device, "Paused the phone “{$device->name}”.");

        return DeviceResource::make($device->load('accounts'));
    }

    public function resume(Request $request, Device $device): DeviceResource
    {
        Gate::authorize('update', $device);
        $device->update(['paused_at' => null]);
        ActionLog::record($request->user(), 'you', 'device.resumed', $device, "Resumed the phone “{$device->name}”.");

        return DeviceResource::make($device->load('accounts'));
    }

    /** The phone's latest screenshot, from its most recent run. */
    public function screenshot(Device $device): BinaryFileResponse
    {
        Gate::authorize('view', $device);
        abort_unless($device->last_screenshot, 404, 'This phone has no screenshot yet.');

        return response()->file(Storage::disk('local')->path($device->last_screenshot), ['Content-Type' => 'image/png']);
    }

    /**
     * The phone's screen right now, for the live view. The X-Screen-* headers give the
     * phone's own size: the frame is scaled down, taps are in the phone's pixels.
     */
    public function live(Device $device, Adb $adb): Response
    {
        Gate::authorize('view', $device);
        $serial = $this->serial($device);

        try {
            $frame = $adb->screenshot($serial);
        } catch (RuntimeException $e) {
            abort(503, $e->getMessage());
        }

        // Watching a phone proves it's there; no need to write that on every frame.
        if (! $device->last_seen_at || $device->last_seen_at->lt(now()->subSeconds(30))) {
            $device->forceFill(['last_seen_at' => now()])->save();
        }

        return response($frame['png'], 200, [
            'Content-Type' => 'image/png',
            'Cache-Control' => 'no-store',
            'X-Screen-Width' => $frame['width'],
            'X-Screen-Height' => $frame['height'],
        ]);
    }

    /**
     * A one-minute ticket for the phone bridge's live stream (phone-bridge/server.js): the
     * phone's video, and touches back unless a publishing run is driving it. The bridge
     * trusts the signature (APP_KEY), so this is where access is decided.
     */
    public function stream(Request $request, Device $device): JsonResponse
    {
        Gate::authorize('view', $device);
        $serial = $this->serial($device);
        $control = $device->booked_run_id === null && $request->user()->can('update', $device);

        $body = rtrim(strtr(base64_encode((string) json_encode([
            'd' => $device->id, 's' => $serial, 'c' => $control, 'e' => now()->addMinute()->timestamp,
        ])), '+/', '-_'), '=');

        return response()->json([
            'url' => '/phone-bridge/stream?ticket='.$body.'.'.hash_hmac('sha256', $body, (string) config('app.key')),
            'control' => $control,
        ]);
    }

    /** Drive the phone by hand: tap, swipe (or long-press), a hardware key, or typed text. */
    public function control(Request $request, Device $device, Adb $adb): Response
    {
        Gate::authorize('update', $device);
        $serial = $this->serial($device);
        abort_if($device->booked_run_id !== null, 409, 'A publishing run is driving this phone. Wait for it, or stop it first.');

        $input = $request->validate([
            'action' => ['required', Rule::in(['tap', 'swipe', 'key', 'text'])],
            'x' => ['required_if:action,tap,swipe', 'integer', 'min:0', 'max:10000'],
            'y' => ['required_if:action,tap,swipe', 'integer', 'min:0', 'max:10000'],
            'x2' => ['required_if:action,swipe', 'integer', 'min:0', 'max:10000'],
            'y2' => ['required_if:action,swipe', 'integer', 'min:0', 'max:10000'],
            'ms' => ['sometimes', 'integer', 'min:50', 'max:5000'],
            'key' => ['required_if:action,key', Rule::in(array_keys(Adb::KEYS))],
            'text' => ['required_if:action,text', 'string', 'max:500'],
        ]);

        try {
            match ($input['action']) {
                'tap' => $adb->tap($serial, $input['x'], $input['y']),
                'swipe' => $adb->swipe($serial, $input['x'], $input['y'], $input['x2'], $input['y2'], $input['ms'] ?? 300),
                'key' => $adb->key($serial, $input['key']),
                'text' => $adb->type($serial, $input['text']),
            };
        } catch (InvalidArgumentException $e) {
            throw ValidationException::withMessages([$input['action'] => $e->getMessage()]);
        } catch (RuntimeException $e) {
            abort(503, $e->getMessage());
        }

        return response()->noContent();
    }

    /** Only a real phone has a screen to watch: its device ID is its adb serial. */
    private function serial(Device $device): string
    {
        abort_if($device->driver !== 'http' || ! $device->ref, 422, 'Only a real phone can be watched and driven. The simulator has no screen.');

        return $device->ref;
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, ?Device $device = null): array
    {
        $partial = $device !== null;
        $driver = $request->input('driver', $device?->driver);

        return $request->validate([
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:60'],
            'driver' => [$partial ? 'sometimes' : 'required', Rule::in(Device::DRIVERS)],
            // The phone-control service addresses each phone by its device ID.
            'ref' => [$driver === 'http' && ! $partial ? 'required' : 'nullable', 'string', 'max:120'],
            'profile' => ['sometimes', Rule::in(Device::PROFILES)],
        ], [
            'ref.required' => 'Enter the device ID the phone-control service uses for this phone.',
        ]);
    }
}
