<?php

namespace App\Services\Lab;

/** Which executor runs which kind of node. */
class Executors
{
    private const MAP = [
        'source.youtube' => Nodes\Youtube::class,
        'text.write' => Nodes\Write::class,
        'text.translate' => Nodes\Write::class,
        'image.generate' => Nodes\Picture::class,
        'image.edit' => Nodes\EditPicture::class,
        'image.paint' => Nodes\Paint::class,
        'image.frame' => Nodes\Frame::class,
        'video.generate' => Nodes\Video::class,
        'video.animate' => Nodes\Video::class,
        'video.slideshow' => Nodes\Slideshow::class,
        'video.reel' => Nodes\Reel::class,
        'video.cut' => Nodes\Cut::class,
        'video.captions' => Nodes\Captions::class,
        'video.mix' => Nodes\Mix::class,
        'video.join' => Nodes\Join::class,
        'audio.voice' => Nodes\Voice::class,
        'audio.music' => Nodes\Music::class,
        'audio.transcribe' => Nodes\Transcribe::class,
        'people.swap' => Nodes\Swap::class,
        'people.dub' => Nodes\Dub::class,
        'clip.moments' => Nodes\Moments::class,
        'finish.design' => Nodes\Design::class,
        'finish.channel' => Nodes\Channel::class,
        'finish.post' => Nodes\PostNode::class,
    ];

    public static function for(string $type): Executor
    {
        $class = self::MAP[$type] ?? throw new NodeFailed('This kind of node has nothing to run.');

        return app($class);
    }
}
