#!/bin/bash

# Configuration
WBC_DIR="src/argus/data/WBC"
mkdir -p "$WBC_DIR/images"
mkdir -p "$WBC_DIR/masks"

BASE_URL="https://raw.githubusercontent.com/zxaoyou/segmentation_WBC/master/Dataset%201"

echo "Downloading WBC segmentation pairs..."

# Download 20 pairs
for i in $(seq -f "%03g" 1 20); do
    # Image (BMP)
    if curl -s -f -L "$BASE_URL/$i.bmp" -o "$WBC_DIR/images/WBC_$i.bmp"; then
        echo -n "I"
    else
        echo -n "x"
    fi

    # Mask (PNG)
    if curl -s -f -L "$BASE_URL/$i.png" -o "$WBC_DIR/masks/WBC_$i.png"; then
        # Rename mask to match convention if needed, or keep 1:1 name
        # Moving to _mask convention for clarity
        mv "$WBC_DIR/masks/WBC_$i.png" "$WBC_DIR/masks/WBC_${i}_mask.png"
        echo -n "M "
    else
        echo -n "x "
    fi
done

echo ""
echo "Downloaded WBC dataset."
