<?php

namespace App\Http\Controllers;

use App\Http\Resources\DeviceResource;
use App\Models\ActionLog;
use App\Models\Device;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
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

    public function destroy(Device $device): Response
    {
        Gate::authorize('delete', $device);
        abort_if($device->booked_run_id !== null, 409, 'This phone is running a job. Stop it first.');

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
        abort_unless($device->last_screenshot && Storage::disk('local')->exists($device->last_screenshot), 404, 'This phone has no screenshot yet.');

        return response()->file(Storage::disk('local')->path($device->last_screenshot), ['Content-Type' => 'image/png']);
    }

    /**
     * @return array<string, mixed>
     */
    private function validated(Request $request, ?Device $device = null): array
    {
        $partial = $device !== null;
        $driver = $request->input('driver', $device?->driver);
        // A phone on the service needs its device ID: on a change too, when it's being cleared or it never had one.
        $needsRef = $driver === 'http' && (! $partial || blank($request->has('ref') ? $request->input('ref') : $device->ref));

        return $request->validate([
            'name' => [$partial ? 'sometimes' : 'required', 'string', 'max:60'],
            'driver' => [$partial ? 'sometimes' : 'required', Rule::in(Device::DRIVERS)],
            // The phone-control service addresses each phone by its device ID (heracles-phone), never by the team key
            // (hk_…), which signs the assistant in and stays in its PHONE_API_KEY.
            'ref' => [$needsRef ? 'required' : 'nullable', 'string', 'max:120', 'not_regex:/^hk_/'],
            'profile' => ['sometimes', Rule::in(Device::PROFILES)],
        ], [
            'ref.required' => 'Enter the device ID the phone-control service uses for this phone.',
            'ref.not_regex' => 'That’s the team key, not the phone’s name: it stays in the assistant’s PHONE_API_KEY. Enter the device ID, e.g. heracles-phone.',
        ]);
    }
}
