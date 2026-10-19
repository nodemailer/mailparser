#!/bin/bash

MESSAGES=20000

MESSAGES=$MESSAGES node passthrough.cjs
MESSAGES=$MESSAGES node parse.cjs
