<?php

namespace App\Services\Lab\Nodes;

use App\Services\Lab\Executor;
use App\Services\Lab\NodeFailed;
use App\Services\Lab\NodeJob;

/** Edit picture: the picture changed by an instruction, on a model that takes a picture in. */
class EditPicture extends Executor
{
    public function start(NodeJob $job): array
    {
        $model = $this->nodeModel($job);
        $image = $job->inputs->asset('image', ['image']) ?? throw new NodeFailed('Connect the picture to edit.');
        $instruction = $this->prompt($job, 'instruction', 'instruction');
        if ($instruction === '') {
            throw new NodeFailed('Say what to change.');
        }
        $job->stage('Editing with '.$model['label']);
        $ratio = $image->ratio();
        $job->generate('image', $model['id'], $instruction, array_filter(['aspect_ratio' => $ratio ? self::nearest($ratio) : null]), [$image->id]);

        return ['wait' => true];
    }

    /** The common shape nearest a ratio, for models that want one named. */
    public static function nearest(float $ratio): string
    {
        $shapes = ['1:1' => 1, '4:5' => 0.8, '3:4' => 0.75, '2:3' => 0.667, '9:16' => 0.5625, '5:4' => 1.25, '4:3' => 1.333, '3:2' => 1.5, '16:9' => 1.778];
        asort($shapes);

        return collect($shapes)->sortBy(fn ($r) => abs(log($r / $ratio)))->keys()->first();
    }
}
