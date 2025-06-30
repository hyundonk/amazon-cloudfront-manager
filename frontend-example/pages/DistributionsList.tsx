import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from 'aws-amplify';
import {
  Button,
  Container,
  Header,
  Pagination,
  SpaceBetween,
  Table,
  TextFilter,
  Box,
  Alert,
  StatusIndicator
} from '@cloudscape-design/components';

interface Distribution {
  id: string;
  name: string;
  status: string;
  domainName: string;
  createdAt: string;
  updatedAt: string;
}

const DistributionsList: React.FC = () => {
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [pageTokens, setPageTokens] = useState<Record<number, string>>({});
  
  const navigate = useNavigate();
  const itemsPerPage = 20;

  useEffect(() => {
    fetchDistributions();
  }, [currentPage]);

  const fetchDistributions = async () => {
    setLoading(true);
    setError(null);
    
    try {
      let apiPath = '/distributions';
      const queryParams: Record<string, string> = {
        limit: itemsPerPage.toString()
      };
      
      // If we have a token for this page, use it
      if (currentPage > 1 && pageTokens[currentPage]) {
        queryParams.nextToken = pageTokens[currentPage];
      }
      
      const response = await API.get('cfManagerApi', apiPath, {
        queryStringParameters: queryParams
      });
      
      setDistributions(response.distributions);
      setTotalCount(response.total);
      
      // Store the next token if available
      if (response.nextToken) {
        setNextToken(response.nextToken);
        setPageTokens(prev => ({
          ...prev,
          [currentPage + 1]: response.nextToken
        }));
      } else {
        setNextToken(null);
      }
    } catch (err: any) {
      console.error('Error fetching distributions:', err);
      setError(err.message || 'Failed to fetch distributions');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDistribution = () => {
    navigate('/distributions/create');
  };

  const handleDistributionClick = (id: string) => {
    navigate(`/distributions/${id}`);
  };

  const filteredDistributions = distributions.filter(dist => 
    dist.name.toLowerCase().includes(filterText.toLowerCase()) ||
    dist.id.toLowerCase().includes(filterText.toLowerCase()) ||
    dist.domainName.toLowerCase().includes(filterText.toLowerCase())
  );

  const getStatusType = (status: string) => {
    switch (status) {
      case 'Deployed':
        return 'success';
      case 'InProgress':
        return 'in-progress';
      case 'Failed':
        return 'error';
      default:
        return 'pending';
    }
  };

  return (
    <Container>
      <SpaceBetween size="l">
        <Header
          variant="h1"
          actions={
            <Button variant="primary" onClick={handleCreateDistribution}>
              Create distribution
            </Button>
          }
        >
          CloudFront Distributions
        </Header>

        {error && (
          <Alert type="error" header="Error">
            {error}
          </Alert>
        )}

        <Table
          loading={loading}
          loadingText="Loading distributions"
          items={filteredDistributions}
          columnDefinitions={[
            {
              id: 'name',
              header: 'Name',
              cell: item => item.name,
              sortingField: 'name'
            },
            {
              id: 'id',
              header: 'Distribution ID',
              cell: item => item.id
            },
            {
              id: 'status',
              header: 'Status',
              cell: item => (
                <StatusIndicator type={getStatusType(item.status)}>
                  {item.status}
                </StatusIndicator>
              )
            },
            {
              id: 'domainName',
              header: 'Domain Name',
              cell: item => item.domainName
            },
            {
              id: 'updatedAt',
              header: 'Last Updated',
              cell: item => new Date(item.updatedAt).toLocaleString(),
              sortingField: 'updatedAt'
            }
          ]}
          selectionType="single"
          onSelectionChange={({ detail }) => {
            if (detail.selectedItems.length > 0) {
              handleDistributionClick(detail.selectedItems[0].id);
            }
          }}
          filter={
            <TextFilter
              filteringPlaceholder="Find distributions"
              filteringText={filterText}
              onChange={({ detail }) => setFilterText(detail.filteringText)}
            />
          }
          pagination={
            <Pagination
              currentPageIndex={currentPage}
              pagesCount={Math.ceil(totalCount / itemsPerPage)}
              onChange={({ detail }) => setCurrentPage(detail.currentPageIndex)}
            />
          }
          empty={
            <Box textAlign="center" color="inherit">
              <b>No distributions</b>
              <Box padding={{ bottom: 's' }} variant="p" color="inherit">
                No CloudFront distributions found.
              </Box>
              <Button onClick={handleCreateDistribution}>Create distribution</Button>
            </Box>
          }
        />
      </SpaceBetween>
    </Container>
  );
};

export default DistributionsList;
