"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { contactEmail, personInitials, safePhotoUrl } from "@/lib/crm/contact-photos";
import { senderLogoUrl } from "@/lib/crm/sender-logo";
import { useCRM } from "./provider";

export function PersonAvatar({
  name,
  email = "",
  photoUrl,
}: {
  name: string;
  email?: string;
  photoUrl?: string;
}) {
  const { contactPhotos } = useCRM();
  const [failedPhoto, setFailedPhoto] = useState("");
  const photo = safePhotoUrl(contactPhotos[contactEmail(email)]) || safePhotoUrl(photoUrl);
  const showPhoto = !!photo && photo !== failedPhoto;
  const image = showPhoto ? photo : senderLogoUrl(email);

  return (
    <Avatar
      data-person-email={contactEmail(email) || undefined}
      aria-hidden="true"
      className="size-8"
    >
      {image && (
        <AvatarImage
          key={image}
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          data-avatar-kind={showPhoto ? "person" : "company"}
          className={showPhoto ? "object-cover" : "bg-white object-contain p-1"}
          onLoadingStatusChange={(status) => {
            if (status === "error" && showPhoto) setFailedPhoto(photo);
          }}
        />
      )}
      <AvatarFallback className="bg-violet-100 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
        {personInitials(name, email)}
      </AvatarFallback>
    </Avatar>
  );
}
