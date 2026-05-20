import type { IProposalResource } from "@/utils/types";
import { CardEmptyState, IconType, Link } from "@aragon/ods";
import React from "react";

interface ICardResourcesProps {
  displayLink?: boolean;
  resources?: IProposalResource[];
  title: string;
}

export const CardResources: React.FC<ICardResourcesProps> = (props) => {
  const { displayLink = true, title } = props;
  let { resources } = props;

  if (resources == null || resources.length === 0) {
    return <CardEmptyState objectIllustration={{ object: "ARCHIVE" }} heading="No resources were added" />;
  }

  // Check that resources is not a empty but not an array
  if (!Array.isArray(resources)) resources = [resources];

  return (
    <div className="flex flex-col gap-y-4 border border-neutral-800 bg-neutral-0 p-6">
      <p className="section-label">— {title}</p>
      <div className="flex flex-col gap-y-4">
        {resources?.map((resource) => (
          <Link
            target="_blank"
            key={resource.url}
            href={resource.url}
            variant="primary"
            iconRight={displayLink ? IconType.LINK_EXTERNAL : undefined}
            description={displayLink ? resource.url : undefined}
          >
            {resource.name}
          </Link>
        ))}
      </div>
    </div>
  );
};
