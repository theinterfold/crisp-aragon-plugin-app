import {
  Button,
  IconType,
  InputText,
  TextAreaRichText,
  Tag,
  InputDate,
  InputTime,
  DropdownContainer,
  DropdownItem,
  InputNumber,
} from "@aragon/ods";
import React, { type ReactNode, useState } from "react";
import type { RawAction } from "@/utils/types";
import { Else, ElseIf, If, Then } from "@/components/if";
import { MainSection } from "@/components/layout/main-section";
import { useCreateProposal } from "../hooks/useCreateProposal";
import { useAccount } from "wagmi";
import { useCanCreateProposal } from "../hooks/useCanCreateProposal";
import { MissingContentView } from "@/components/MissingContentView";
import { useWeb3Modal } from "@web3modal/wagmi/react";
import type { Address } from "viem";
import { NewActionDialog, type NewActionType } from "@/components/dialogs/NewActionDialog";
import { AddActionCard } from "@/components/cards/AddActionCard";
import { ProposalActions } from "@/components/proposalActions/proposalActions";
import { downloadAsFile } from "@/utils/download-as-file";
import { encodeActionsAsJson } from "@/utils/json-actions";
import { CreditsMode } from "../utils/types";

export default function Create() {
  const { address: selfAddress, isConnected } = useAccount();
  const canCreate = useCanCreateProposal();
  const [addActionType, setAddActionType] = useState<NewActionType>("");
  const {
    title,
    summary,
    description,
    actions,
    resources,
    setTitle,
    setSummary,
    setDescription,
    setActions,
    setResources,
    isCreating,
    submitProposal,
    startDate,
    startTime,
    endDate,
    endTime,
    setStartDate,
    setStartTime,
    setEndDate,
    setEndTime,
    credits,
    setCredits,
    creditsMode,
    setCreditsMode,
    numOptions,
    setNumOptions,
    optionLabels,
    setOptionLabels,
  } = useCreateProposal();

  const inputWrapperClassName =
    "focus-within:!outline-none focus-within:!ring-0 focus-within:!border-transparent focus-within:!shadow-none focus-within:!ring-0 focus:border-[#000]";

  const handleTitleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(event?.target?.value);
  };
  const handleSummaryInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSummary(event?.target?.value);
  };
  const handleNewActionDialogClose = (newAction: RawAction[] | null) => {
    if (!newAction) {
      setAddActionType("");
      return;
    }

    setActions(actions.concat(newAction));
    setAddActionType("");
  };
  const onRemoveAction = (idx: number) => {
    actions.splice(idx, 1);
    setActions([].concat(actions as any));
  };
  const removeResource = (idx: number) => {
    resources.splice(idx, 1);
    setResources([].concat(resources as any));
  };
  const onResourceNameChange = (event: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    resources[idx].name = event.target.value;
    setResources([].concat(resources as any));
  };
  const onResourceUrlChange = (event: React.ChangeEvent<HTMLInputElement>, idx: number) => {
    resources[idx].url = event.target.value;
    setResources([].concat(resources as any));
  };

  const exportAsJson = () => {
    if (!actions.length) return;

    const strResult = encodeActionsAsJson(actions);
    downloadAsFile("actions.json", strResult, "text/json");
  };

  return (
    <MainSection narrow={true}>
      <div className="w-full justify-between">
        <div className="page-head mb-8">
          <div>
            <div className="kicker mb-3">02 · Governance / Submit</div>
            <h1 className="display-title">New proposal</h1>
          </div>
        </div>

        <PlaceHolderOr selfAddress={selfAddress} canCreate={canCreate} isConnected={isConnected}>
          <p className="form-intro">
            A proposal becomes <em>active</em> the moment it is mined. Voters then have the window you set to cast
            encrypted ballots — tallies decrypt only once that window closes.
          </p>
          <div className="mb-6">
            <InputText
              className=""
              label="Title"
              maxLength={100}
              placeholder="A short title that describes the main purpose"
              variant="default"
              value={title}
              readOnly={isCreating}
              onChange={handleTitleInput}
            />
          </div>
          <div className="mb-6">
            <InputText
              className=""
              label="Summary"
              maxLength={280}
              placeholder="A short summary that outlines the main purpose of the proposal"
              variant="default"
              value={summary}
              readOnly={isCreating}
              onChange={handleSummaryInput}
            />
          </div>
          <div className="mb-6">
            <TextAreaRichText
              label="Body"
              className="pt-2"
              value={description}
              onChange={setDescription}
              placeholder="A description of what the proposal is all about"
            />
          </div>

          <div className="mb-6 flex flex-col gap-y-2 md:gap-y-3">
            <div className="flex flex-col gap-0.5 md:gap-1">
              <div className="flex items-center gap-x-3">
                <p className="field-section-label">Resources</p>
                <Tag label="Optional" />
              </div>
              <p className="text-sm font-normal leading-normal text-neutral-500 md:text-base">
                Add links to external resources
              </p>
            </div>
            <div className="flex flex-col gap-y-4 rounded-xl border border-neutral-100 bg-neutral-0 p-4">
              <If lengthOf={resources} is={0}>
                <p className="text-sm font-normal leading-normal text-neutral-500 md:text-base">
                  There are no resources yet. Click the button below to add the first one.
                </p>
              </If>
              {resources.map((resource, idx) => {
                return (
                  <div key={idx} className="flex flex-col gap-y-3 py-3 md:py-4">
                    <div className="flex items-end gap-x-3">
                      <InputText
                        label="Resource name"
                        readOnly={isCreating}
                        value={resource.name}
                        onChange={(e) => onResourceNameChange(e, idx)}
                        placeholder="GitHub, Twitter, etc."
                      />
                      <Button
                        size="lg"
                        variant="tertiary"
                        onClick={() => removeResource(idx)}
                        iconLeft={IconType.MINUS}
                      />
                    </div>
                    <InputText
                      label="URL"
                      value={resource.url}
                      onChange={(e) => onResourceUrlChange(e, idx)}
                      placeholder="https://..."
                      readOnly={isCreating}
                    />
                  </div>
                );
              })}
            </div>
            <span className="mt-3">
              <Button
                variant="tertiary"
                size="lg"
                iconLeft={IconType.PLUS}
                disabled={isCreating}
                onClick={() => {
                  setResources(resources.concat({ url: "", name: "" }));
                }}
              >
                Add resource
              </Button>
            </span>
          </div>

          {/* Dates */}
          <div className="mb-6 flex flex-row gap-x-5">
            <div className="flex flex-1 flex-col">
              <InputDate
                wrapperClassName={inputWrapperClassName}
                className="w-full"
                label="Start date *"
                variant="default"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <InputTime
                wrapperClassName={inputWrapperClassName}
                className="w-full"
                variant="default"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="flex flex-1 flex-col">
              <InputDate
                wrapperClassName={inputWrapperClassName}
                className="w-full"
                label="End date *"
                variant="default"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <InputTime
                wrapperClassName={inputWrapperClassName}
                className="w-full"
                variant="default"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          {/** CRISP Configuration */}
          <div className="mb-6 flex flex-col gap-y-2 md:gap-y-3">
            <div className="flex flex-col gap-0.5 md:gap-1">
              <div className="flex gap-x-3">
                <p className="field-section-label">Configuration</p>
              </div>
              <p className="text-sm font-normal leading-normal text-neutral-500 md:text-base">Configure the proposal</p>
            </div>

            <div className="flex flex-col gap-y-4 rounded-xl border border-neutral-100 bg-neutral-0 p-4">
              {/* Credit Mode */}
              <div className="flex flex-col gap-y-2">
                <label className="text-base font-normal leading-tight text-neutral-800">Credit Mode</label>
                <DropdownContainer
                  label={creditsMode === CreditsMode.CONSTANT ? "Constant Credits" : "Custom Credits"}
                  disabled={isCreating}
                >
                  <DropdownItem
                    selected={creditsMode === CreditsMode.CONSTANT}
                    onSelect={() => setCreditsMode(CreditsMode.CONSTANT)}
                  >
                    Constant Credits
                  </DropdownItem>
                  <DropdownItem
                    selected={creditsMode === CreditsMode.CUSTOM}
                    onSelect={() => setCreditsMode(CreditsMode.CUSTOM)}
                  >
                    Custom Credits
                  </DropdownItem>
                </DropdownContainer>
                <p className="text-sm font-normal leading-normal text-neutral-500">
                  {creditsMode === CreditsMode.CONSTANT
                    ? "All eligible voters receive the same number of credits."
                    : "Credits are based on each voter's token balance."}
                </p>
              </div>

              {/* Credits Amount (only for constant mode) */}
              {creditsMode === CreditsMode.CONSTANT && (
                <div className="flex flex-col gap-y-2">
                  <InputText
                    label="Credits per Voter"
                    value={credits.toString()}
                    onChange={(e) => setCredits(Number(e.target.value))}
                    placeholder="e.g. 100"
                    readOnly={isCreating}
                  />
                  <p className="text-sm font-normal leading-normal text-neutral-500">
                    Number of voting credits each eligible voter receives.
                  </p>
                </div>
              )}

              {/* Number of Options */}
              <div className="flex flex-col gap-y-2">
                <InputNumber
                  label="Number of Options"
                  value={numOptions}
                  min={2}
                  max={10}
                  step={1}
                  onChange={(value) => {
                    const newNum = Number.parseInt(value, 10) ?? 2;
                    setNumOptions(newNum);

                    // Adjust options array based on number
                    if (newNum === 2) {
                      setOptionLabels(["Yes", "No"]);
                    } else if (newNum === 3) {
                      setOptionLabels(["Yes", "No", "Abstain"]);
                    } else {
                      setOptionLabels((prev) => {
                        const newLabels = [...prev];
                        while (newLabels.length < newNum) {
                          newLabels.push(`Option ${newLabels.length + 1}`);
                        }
                        return newLabels.slice(0, newNum);
                      });
                    }
                  }}
                  placeholder="e.g. 2"
                  disabled={isCreating}
                />
                <p className="text-sm font-normal leading-normal text-neutral-500">
                  Number of voting options (2-10). Two options enforces single-choice voting.
                </p>
              </div>

              {/* Option Labels */}
              <div className="flex flex-col gap-y-2">
                <label className="text-base font-normal leading-tight text-neutral-800">Option Labels</label>
                <p className="text-sm font-normal leading-normal text-neutral-500">
                  {numOptions === 2
                    ? "Binary vote with Yes/No options."
                    : numOptions === 3
                      ? "Standard vote with Yes/No/Abstain options."
                      : "Customize the label for each voting option."}
                </p>
                <div className="flex flex-col gap-y-3 pt-2">
                  {optionLabels.map((label, idx) => (
                    <div key={idx} className="flex items-center gap-x-3">
                      <span className="font-medium w-8 text-sm text-neutral-500">{idx + 1}.</span>
                      <InputText
                        className="flex-1"
                        value={label}
                        onChange={(e) => {
                          const newLabels = [...optionLabels];
                          newLabels[idx] = e.target.value;
                          setOptionLabels(newLabels);
                        }}
                        placeholder={`Option ${idx + 1}`}
                        readOnly={isCreating || numOptions <= 3}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <ProposalActions
            actions={actions}
            emptyListDescription="The proposal has no actions defined yet. Select a type of action to add to the proposal."
            onRemove={(idx) => onRemoveAction(idx)}
          />

          <If lengthOf={actions} above={0}>
            <Button
              className="mt-6"
              iconLeft={IconType.RICHTEXT_LIST_UNORDERED}
              size="lg"
              variant="tertiary"
              onClick={() => exportAsJson()}
            >
              Export actions as JSON
            </Button>
          </If>

          <div className="mt-8 grid w-full grid-cols-2 gap-4 md:grid-cols-4">
            <AddActionCard
              title="Add a payment"
              icon={IconType.WITHDRAW}
              disabled={isCreating}
              onClick={() => setAddActionType("withdrawal")}
            />
            <AddActionCard
              title="Add a function call"
              icon={IconType.BLOCKCHAIN_BLOCKCHAIN}
              disabled={isCreating}
              onClick={() => setAddActionType("select-abi-function")}
            />
            <AddActionCard
              title="Add raw calldata"
              icon={IconType.COPY}
              disabled={isCreating}
              onClick={() => setAddActionType("calldata")}
            />
            <AddActionCard
              title="Import JSON actions"
              disabled={isCreating}
              icon={IconType.RICHTEXT_LIST_UNORDERED}
              onClick={() => setAddActionType("import-json")}
            />
          </div>

          {/* Dialog */}

          <NewActionDialog
            newActionType={addActionType}
            onClose={(newActions) => handleNewActionDialogClose(newActions)}
          />

          {/* Submit */}

          <div className="actions-row">
            <Button isLoading={isCreating} size="lg" variant="primary" onClick={() => submitProposal()}>
              <If lengthOf={actions} above={0}>
                <Then>Submit proposal</Then>
                <Else>Submit signaling proposal</Else>
              </If>
            </Button>
            <div className="flex-1" />
            <span className="gas-note">Encrypted on-chain ballot</span>
          </div>
        </PlaceHolderOr>
      </div>
    </MainSection>
  );
}

const PlaceHolderOr = ({
  selfAddress,
  isConnected,
  canCreate,
  children,
}: {
  selfAddress: Address | undefined;
  isConnected: boolean;
  canCreate: boolean | undefined;
  children: ReactNode;
}) => {
  const { open } = useWeb3Modal();
  return (
    <If true={!selfAddress || !isConnected}>
      <Then>
        {/* Not connected */}
        <MissingContentView callToAction="Connect wallet" onClick={() => open()}>
          Please connect your wallet to continue.
        </MissingContentView>
      </Then>
      <ElseIf true={!canCreate}>
        {/* Not a member */}
        <MissingContentView>
          You cannot create proposals on the multisig because you are not currently defined as a member.
        </MissingContentView>
      </ElseIf>
      <Else>{children}</Else>
    </If>
  );
};
