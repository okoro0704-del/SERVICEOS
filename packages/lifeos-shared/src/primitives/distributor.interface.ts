export type DeployRequest = {
  shellId: string;
  artifactTag: string;
  environment?: "staging" | "production";
};

export type DeployResult = {
  deploymentId: string;
  status: "accepted" | "running" | "failed";
  url?: string;
};

/**
 * Primitive #5 — Master Distributor Engine (Infrastructure & auto-deployment).
 */
export interface IMasterDistributorClient {
  readonly primitiveId: "master-distributor";
  readonly bound: boolean;
  health(): Promise<{ ok: boolean; service?: string }>;
  requestDeploy(input: DeployRequest): Promise<DeployResult>;
  getDeployment(deploymentId: string): Promise<DeployResult>;
}

export type IDistributorProvider = IMasterDistributorClient;
