<?php

namespace App\Services\Lab;

use RuntimeException;

/** A node couldn't run; the message is for the person (or the assistant) who asked. */
class NodeFailed extends RuntimeException {}
