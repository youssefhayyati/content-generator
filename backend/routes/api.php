<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\AccountVoiceController;
use App\Http\Controllers\AgentController;
use App\Http\Controllers\AnalyticsController;
use App\Http\Controllers\AssetController;
use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Auth\EmailVerificationNotificationController;
use App\Http\Controllers\Auth\NewPasswordController;
use App\Http\Controllers\Auth\PasswordResetLinkController;
use App\Http\Controllers\Auth\RegisteredUserController;
use App\Http\Controllers\Auth\SocialiteController;
use App\Http\Controllers\Auth\VerifyEmailController;
use App\Http\Controllers\AutonomyController;
use App\Http\Controllers\CampaignController;
use App\Http\Controllers\CampaignPhotoController;
use App\Http\Controllers\CampaignPlanController;
use App\Http\Controllers\CampaignReviewController;
use App\Http\Controllers\CampaignScheduleController;
use App\Http\Controllers\CommentController;
use App\Http\Controllers\DeviceController;
use App\Http\Controllers\FlowController;
use App\Http\Controllers\FlowRunController;
use App\Http\Controllers\GenerationController;
use App\Http\Controllers\InboxController;
use App\Http\Controllers\InboxNoteController;
use App\Http\Controllers\InvestigationController;
use App\Http\Controllers\LiveController;
use App\Http\Controllers\ModelController;
use App\Http\Controllers\OverviewController;
use App\Http\Controllers\PasswordController;
use App\Http\Controllers\PostController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\PublishingController;
use App\Http\Controllers\QueueSlotController;
use App\Http\Controllers\RecipeController;
use App\Http\Controllers\RepostController;
use App\Http\Controllers\SocialAccountController;
use App\Http\Controllers\SoundController;
use App\Http\Controllers\SpecController;
use App\Http\Controllers\StormGuardController;
use App\Http\Controllers\WritingController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function () {
    Route::get('providers', [SocialiteController::class, 'providers']);

    Route::middleware('throttle:auth')->group(function () {
        Route::post('register', RegisteredUserController::class);
        Route::post('login', [AuthenticatedSessionController::class, 'store']);
        Route::post('forgot-password', PasswordResetLinkController::class);
        Route::post('reset-password', NewPasswordController::class);
    });

    Route::get('verify-email/{id}/{hash}', VerifyEmailController::class)
        ->middleware(['signed', 'throttle:6,1'])
        ->name('verification.verify');

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('logout', [AuthenticatedSessionController::class, 'destroy']);
        Route::post('email/verification-notification', EmailVerificationNotificationController::class)
            ->middleware('throttle:6,1');
    });
});

Route::middleware('auth:sanctum')->group(function () {
    Route::get('inspirations/discover', [\App\Http\Controllers\InspirationController::class, 'discover'])->middleware('throttle:30,1');
    Route::get('inspirations', [\App\Http\Controllers\InspirationController::class, 'index']);
    Route::post('inspirations', [\App\Http\Controllers\InspirationController::class, 'store']);
    Route::delete('inspirations/{id}', [\App\Http\Controllers\InspirationController::class, 'destroy']);
    Route::get('user', [ProfileController::class, 'show']);
    Route::patch('user', [ProfileController::class, 'update']);
    Route::delete('user', [ProfileController::class, 'destroy']);
    Route::put('user/password', PasswordController::class);
    Route::delete('user/social/{provider}', [SocialAccountController::class, 'destroy']);

    Route::get('overview', OverviewController::class);
    Route::get('live', LiveController::class);
    Route::get('analytics', AnalyticsController::class);

    Route::post('posts/{post}/duplicate', [PostController::class, 'duplicate']);
    Route::apiResource('posts', PostController::class);

    Route::get('inbox', InboxController::class);

    // The media library.
    Route::get('assets', [AssetController::class, 'index']);
    Route::post('assets', [AssetController::class, 'store']);
    Route::get('assets/{asset}/file', [AssetController::class, 'file']);
    Route::get('assets/{asset}/poster', [AssetController::class, 'poster']);
    Route::delete('assets/{asset}', [AssetController::class, 'destroy']);

    // Where posts go: accounts, and the phones that publish to them.
    Route::apiResource('accounts', AccountController::class);
    Route::apiResource('devices', DeviceController::class)->except('show');
    Route::post('devices/{device}/pause', [DeviceController::class, 'pause']);
    Route::post('devices/{device}/resume', [DeviceController::class, 'resume']);
    Route::get('devices/{device}/screenshot', [DeviceController::class, 'screenshot']);

    // The publishing engine: the records, the stop button, the operator's recovery moves,
    // and the token the automation service signs its calls with.
    Route::get('publishing/runs', [PublishingController::class, 'index']);
    Route::get('publishing/runs/{run}', [PublishingController::class, 'show']);
    Route::get('publishing/usage', [PublishingController::class, 'usage']);
    Route::post('publishing/pause', [PublishingController::class, 'pause']);
    Route::post('publishing/resume', [PublishingController::class, 'resume']);
    Route::get('publishing/agent-token', [PublishingController::class, 'token']);
    Route::post('publishing/agent-token/rotate', [PublishingController::class, 'rotateToken']);
    Route::post('posts/{post}/retry', [PublishingController::class, 'retry']);
    Route::post('posts/{post}/confirm-live', [PublishingController::class, 'confirm']);

    // Platform specs and the pre-export check.
    Route::get('platform-specs', [SpecController::class, 'index']);
    Route::post('checks', [SpecController::class, 'check']);

    // The studio: models, generators, projects and recipes.
    Route::get('models', [ModelController::class, 'index']);
    Route::get('models/evals', [ModelController::class, 'evals']);
    Route::post('models/evals', [ModelController::class, 'runEvals'])->middleware(['verified', 'throttle:ai']);
    Route::post('models/test/{provider}', [ModelController::class, 'test'])->middleware('throttle:10,1');
    Route::get('generations', [GenerationController::class, 'index']);
    Route::get('generations/{generation}', [GenerationController::class, 'show']);
    Route::delete('generations/{generation}', [GenerationController::class, 'destroy']);
    Route::middleware(['verified', 'throttle:intake'])->group(function () {
        Route::post('generations', [GenerationController::class, 'store']);
        Route::post('generations/text', [GenerationController::class, 'text']);
        Route::post('generations/{generation}/retry', [GenerationController::class, 'retry']);
        Route::post('recipes/{recipe}', [RecipeController::class, 'run']);
    });
    Route::apiResource('projects', ProjectController::class);

    Route::get('queue-slots', [QueueSlotController::class, 'index']);
    Route::put('queue-slots', [QueueSlotController::class, 'update']);

    Route::get('ai', [WritingController::class, 'options']);
    // Every request spends API credit: confirmed accounts only, and not too fast.
    Route::post('ai/write', [WritingController::class, 'write'])->middleware(['verified', 'throttle:ai']);

    // Campaign intake. The interview also runs without AI (the standard question list), so only
    // the content kit insists on a confirmed account; every step that may call Claude is throttled.
    Route::get('campaigns', [CampaignController::class, 'index']);
    Route::post('campaigns', [CampaignController::class, 'store']);
    Route::get('campaigns/{campaign}', [CampaignController::class, 'show']);
    Route::patch('campaigns/{campaign}', [CampaignController::class, 'update']);

    // The campaign engine: plan (gate 6A), production, review (gate 6B), schedule.
    Route::get('campaigns/{campaign}/items', [CampaignPlanController::class, 'items']);
    Route::post('campaigns/{campaign}/items', [CampaignPlanController::class, 'store']);
    Route::put('campaigns/{campaign}/items/order', [CampaignPlanController::class, 'reorder']);
    Route::patch('campaigns/{campaign}/items/{item}', [CampaignPlanController::class, 'update'])->scopeBindings();
    Route::delete('campaigns/{campaign}/items/{item}', [CampaignPlanController::class, 'destroy'])->scopeBindings();
    Route::put('campaigns/{campaign}/items/{item}/media', [CampaignPlanController::class, 'media'])->scopeBindings();
    Route::post('campaigns/{campaign}/approve-plan', [CampaignPlanController::class, 'approvePlan']);
    Route::post('campaigns/{campaign}/variants/approve-all', [CampaignReviewController::class, 'approveAll']);
    Route::post('campaigns/{campaign}/variants/{variant}/approve', [CampaignReviewController::class, 'approve']);
    Route::patch('campaigns/{campaign}/variants/{variant}', [CampaignReviewController::class, 'update']);
    Route::post('campaigns/{campaign}/variants/{variant}/like', [CampaignReviewController::class, 'like']);
    Route::post('campaigns/{campaign}/schedule', [CampaignScheduleController::class, 'schedule']);
    Route::post('campaigns/{campaign}/variants/{variant}/times', [CampaignScheduleController::class, 'addTime']);
    Route::get('schedule/conflicts', [CampaignScheduleController::class, 'conflicts']);

    // Account voice: memory, and profile changes that wait for approval.
    Route::get('accounts/{account}/voice', [AccountVoiceController::class, 'show']);
    Route::post('accounts/{account}/memory', [AccountVoiceController::class, 'remember']);
    Route::delete('accounts/{account}/memory/{memory}', [AccountVoiceController::class, 'forget']);
    Route::post('accounts/{account}/profile/changes', [AccountVoiceController::class, 'propose']);
    Route::post('accounts/{account}/profile/changes/{change}', [AccountVoiceController::class, 'decide']);

    // Autonomy: the mode, the action matrix, the mode-B rules, and the policy preview.
    Route::get('accounts/{account}/autonomy', [AutonomyController::class, 'show']);
    Route::get('accounts/{account}/autonomy/preview', [AutonomyController::class, 'preview']);
    Route::post('accounts/{account}/autonomy/rules', [AutonomyController::class, 'storeRule']);
    Route::delete('accounts/{account}/autonomy/rules/{rule}', [AutonomyController::class, 'destroyRule']);

    // Repost from X to Instagram: pick, record permission, adapt, credit, schedule.
    Route::get('reposts', [RepostController::class, 'index']);
    Route::post('reposts', [RepostController::class, 'store']);
    Route::post('reposts/{repost}/permission', [RepostController::class, 'permission']);
    Route::post('reposts/{repost}/schedule', [RepostController::class, 'schedule']);
    Route::delete('reposts/{repost}', [RepostController::class, 'destroy']);
    Route::post('reposts/{repost}/adapt', [RepostController::class, 'adapt'])->middleware(['verified', 'throttle:ai']);

    // The comment inbox: triage by AI, replies approved by a human before they go out.
    Route::get('comments', [CommentController::class, 'index']);
    Route::post('comments', [CommentController::class, 'store']);
    Route::post('comments/{comment}/send', [CommentController::class, 'send']);
    Route::post('comments/{comment}/ignore', [CommentController::class, 'ignore']);
    Route::delete('comments/{comment}', [CommentController::class, 'destroy']);
    Route::post('comments/{comment}/triage', [CommentController::class, 'triage'])->middleware(['verified', 'throttle:ai']);

    // Flows: automations drawn on a canvas, started from a template or described in words.
    Route::get('flows', [FlowController::class, 'index']);
    Route::get('flows/catalog', [FlowController::class, 'catalog']);
    Route::post('flows', [FlowController::class, 'store']);
    Route::get('flows/{flow}', [FlowController::class, 'show']);
    Route::patch('flows/{flow}', [FlowController::class, 'update']);
    Route::delete('flows/{flow}', [FlowController::class, 'destroy']);
    Route::post('flows/{flow}/run', [FlowController::class, 'run'])->middleware('throttle:ai');
    Route::post('flows/compose', [FlowController::class, 'compose'])->middleware(['verified', 'throttle:ai']);
    Route::get('flow-runs/{run}', [FlowRunController::class, 'show']);
    Route::post('flow-runs/{run}/decide', [FlowRunController::class, 'decide']);
    Route::post('flow-runs/{run}/stop', [FlowRunController::class, 'stop']);
    Route::post('inbox/notes/{note}/dismiss', [InboxNoteController::class, 'dismiss']);

    // Sound: voices and moods, samples, dictation, scripts, transcripts, an account's sound.
    Route::get('sound', [SoundController::class, 'index']);
    Route::get('sound/voices/{voice}/sample', [SoundController::class, 'sample'])->where('voice', '[a-z]{2}_[a-z]+')->middleware('throttle:60,1');
    Route::post('sound/dictate', [SoundController::class, 'dictate'])->middleware(['verified', 'throttle:intake']);
    Route::post('sound/script', [SoundController::class, 'script'])->middleware(['verified', 'throttle:ai']);
    Route::get('assets/{asset}/words', [SoundController::class, 'words']);
    Route::post('assets/{asset}/transcribe', [SoundController::class, 'transcribe'])->middleware(['verified', 'throttle:intake']);
    Route::post('assets/{asset}/posts', [SoundController::class, 'posts'])->middleware(['verified', 'throttle:ai']);
    Route::put('accounts/{account}/sound', [SoundController::class, 'account']);

    // Storm Guard: the brand-safety circuit breaker on each account's comments.
    Route::get('storm-guard', [StormGuardController::class, 'index']);
    Route::put('accounts/{account}/storm-guard', [StormGuardController::class, 'update']);
    Route::post('accounts/{account}/storm-guard/clear', [StormGuardController::class, 'clear']);

    // The investigator: collect → compare → validate → report, on demand.
    Route::apiResource('investigations', InvestigationController::class)->only(['index', 'store', 'show', 'destroy']);
    Route::delete('campaigns/{campaign}', [CampaignController::class, 'destroy']);
    Route::get('campaigns/{campaign}/photos/{photo}', [CampaignPhotoController::class, 'show'])->scopeBindings();
    Route::delete('campaigns/{campaign}/photos/{photo}', [CampaignPhotoController::class, 'destroy'])->scopeBindings();

    Route::middleware('throttle:intake')->group(function () {
        Route::post('campaigns/{campaign}/plan', [CampaignPlanController::class, 'plan'])->middleware('verified');
        Route::post('campaigns/{campaign}/resume', [CampaignPlanController::class, 'resume'])->middleware('verified');
        Route::post('campaigns/{campaign}/items/{item}/shots/{shot}', [CampaignPlanController::class, 'regenerateShot'])->middleware('verified')->scopeBindings();
        Route::post('campaigns/{campaign}/variants/{variant}/reject', [CampaignReviewController::class, 'reject'])->middleware('verified');
        Route::post('accounts/{account}/profile/suggest', [AccountVoiceController::class, 'suggest'])->middleware('verified');
        Route::post('campaigns/{campaign}/turn', [CampaignController::class, 'turn']);
        Route::post('campaigns/{campaign}/deeper', [CampaignController::class, 'deeper']);
        Route::post('campaigns/{campaign}/photos', [CampaignPhotoController::class, 'store']);
        Route::post('campaigns/{campaign}/kit', [CampaignController::class, 'kit'])->middleware('verified');
    });
});

// The agent API: how the automation service (the Python dev) works its phones. Bearer token,
// never a session. The loop: next job → steps and screenshots as it goes → finish.
Route::prefix('agent')->middleware('agent')->group(function () {
    Route::get('next-job', [AgentController::class, 'nextJob']);
    Route::post('runs/{run:uuid}/steps', [AgentController::class, 'steps']);
    Route::post('runs/{run:uuid}/screenshot', [AgentController::class, 'screenshot']);
    Route::post('runs/{run:uuid}/finish', [AgentController::class, 'finish']);
    Route::get('assets/{asset}/file', [AgentController::class, 'assetFile']);
});
