import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import type { LoadedSprite } from "./controller";

/** One animation row of a pet, cropped and stepped with timers so it also runs on phones. */
export function PetSprite({ sprite, animation, height }: { sprite: LoadedSprite; animation: string; height: number }) {
  const anim = sprite.animations[animation] ?? sprite.animations[sprite.defaultAnimation] ?? sprite.animations.idle;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (!anim) return;
    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      timer = setTimeout(() => {
        index = (index + 1) % anim.frames;
        setFrame(index);
        step();
      }, anim.frameDurationsMs[index] ?? 125);
    };
    step();
    return () => clearTimeout(timer);
  }, [anim]);

  if (!anim) return null;
  const scale = height / sprite.frame.height;
  const width = sprite.frame.width * scale;
  return (
    <View style={{ width, height, overflow: "hidden" }} accessibilityLabel={sprite.displayName}>
      <Image
        source={{ uri: sprite.dataUrl }}
        style={{
          position: "absolute",
          width: sprite.sheet.width * scale,
          height: sprite.sheet.height * scale,
          left: -(frame % anim.frames) * width,
          top: -anim.row * height,
        }}
      />
    </View>
  );
}
