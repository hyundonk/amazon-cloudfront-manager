import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from 'aws-amplify';
import {
  Button,
  Container,
  Form,
  FormField,
  Header,
  Input,
  Select,
  SpaceBetween,
  Tabs,
  Textarea,
  Alert,
  Box,
  ColumnLayout
} from '@cloudscape-design/components';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
}

const DistributionCreate: React.FC = () => {
  const navigate = useNavigate();
  
  const [name, setName] = useState<string>('');
  const [comment, setComment] = useState<string>('');
  const [priceClass, setPriceClass] = useState<string>('PriceClass_100');
  const [defaultRootObject, setDefaultRootObject] = useState<string>('index.html');
  const [originDomainName, setOriginDomainName] = useState<string>('');
  const [originPath, setOriginPath] = useState<string>('');
  const [viewerProtocolPolicy, setViewerProtocolPolicy] = useState<string>('redirect-to-https');
  
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTabId, setActiveTabId] = useState<string>('custom');
  
  useEffect(() => {
    fetchTemplates();
  }, []);
  
  const fetchTemplates = async () => {
    try {
      const response = await API.get('cfManagerApi', '/templates', {});
      setTemplates(response.templates);
    } catch (err: any) {
      console.error('Error fetching templates:', err);
    }
  };
  
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      if (activeTabId === 'template' && selectedTemplate) {
        // Create from template
        const response = await API.post('cfManagerApi', `/templates/${selectedTemplate}/apply`, {
          body: {
            name,
            parameters: {
              comment,
              priceClass,
              defaultRootObject,
              origins: [
                {
                  domainName: originDomainName,
                  originPath
                }
              ]
            }
          }
        });
        
        navigate(`/distributions/${response.id}`);
      } else {
        // Create custom distribution
        const distributionConfig = {
          CallerReference: Date.now().toString(),
          Comment: comment,
          DefaultRootObject: defaultRootObject,
          PriceClass: priceClass,
          Enabled: true,
          Origins: {
            Quantity: 1,
            Items: [
              {
                Id: 'origin1',
                DomainName: originDomainName,
                OriginPath: originPath,
                CustomOriginConfig: {
                  HTTPPort: 80,
                  HTTPSPort: 443,
                  OriginProtocolPolicy: 'https-only',
                  OriginSslProtocols: {
                    Quantity: 1,
                    Items: ['TLSv1.2']
                  },
                  OriginReadTimeout: 30,
                  OriginKeepaliveTimeout: 5
                }
              }
            ]
          },
          DefaultCacheBehavior: {
            TargetOriginId: 'origin1',
            ViewerProtocolPolicy: viewerProtocolPolicy,
            AllowedMethods: {
              Quantity: 7,
              Items: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
              CachedMethods: {
                Quantity: 3,
                Items: ['GET', 'HEAD', 'OPTIONS']
              }
            },
            CachePolicyId: '658327ea-f89d-4fab-a63d-7e88639e58f6', // CachingOptimized
            OriginRequestPolicyId: '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf', // CORS-S3Origin
            Compress: true
          }
        };
        
        const response = await API.post('cfManagerApi', '/distributions', {
          body: {
            name,
            config: distributionConfig
          }
        });
        
        navigate(`/distributions/${response.id}`);
      }
    } catch (err: any) {
      console.error('Error creating distribution:', err);
      setError(err.message || 'Failed to create distribution');
    } finally {
      setLoading(false);
    }
  };
  
  const handleCancel = () => {
    navigate('/');
  };
  
  return (
    <Container>
      <SpaceBetween size="l">
        <Header variant="h1">Create CloudFront Distribution</Header>
        
        {error && (
          <Alert type="error" header="Error">
            {error}
          </Alert>
        )}
        
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSubmit} loading={loading}>
                Create distribution
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <FormField label="Distribution name" description="A friendly name for this distribution">
              <Input
                value={name}
                onChange={({ detail }) => setName(detail.value)}
                placeholder="My Distribution"
              />
            </FormField>
            
            <Tabs
              activeTabId={activeTabId}
              onChange={({ detail }) => setActiveTabId(detail.activeTabId)}
              tabs={[
                {
                  id: 'custom',
                  label: 'Custom distribution',
                  content: (
                    <SpaceBetween size="l">
                      <ColumnLayout columns={2}>
                        <FormField label="Comment" description="Optional description for this distribution">
                          <Input
                            value={comment}
                            onChange={({ detail }) => setComment(detail.value)}
                            placeholder="My CloudFront distribution"
                          />
                        </FormField>
                        
                        <FormField label="Price class" description="Controls which edge locations will serve your content">
                          <Select
                            selectedOption={{ label: priceClass === 'PriceClass_100' ? 'Use only US, Canada and Europe' : 
                                                  priceClass === 'PriceClass_200' ? 'Use US, Canada, Europe, Asia, Middle East and Africa' : 
                                                  'Use all edge locations (best performance)', value: priceClass }}
                            onChange={({ detail }) => setPriceClass(detail.selectedOption.value || 'PriceClass_100')}
                            options={[
                              { label: 'Use only US, Canada and Europe', value: 'PriceClass_100' },
                              { label: 'Use US, Canada, Europe, Asia, Middle East and Africa', value: 'PriceClass_200' },
                              { label: 'Use all edge locations (best performance)', value: 'PriceClass_All' }
                            ]}
                          />
                        </FormField>
                      </ColumnLayout>
                      
                      <FormField label="Default root object" description="The object that will be returned when the root URL is requested">
                        <Input
                          value={defaultRootObject}
                          onChange={({ detail }) => setDefaultRootObject(detail.value)}
                          placeholder="index.html"
                        />
                      </FormField>
                      
                      <Header variant="h3">Origin Settings</Header>
                      
                      <FormField label="Origin domain name" description="The DNS domain name of your origin">
                        <Input
                          value={originDomainName}
                          onChange={({ detail }) => setOriginDomainName(detail.value)}
                          placeholder="example-bucket.s3.amazonaws.com"
                        />
                      </FormField>
                      
                      <FormField label="Origin path" description="Optional path that CloudFront appends to the origin domain name">
                        <Input
                          value={originPath}
                          onChange={({ detail }) => setOriginPath(detail.value)}
                          placeholder="/production"
                        />
                      </FormField>
                      
                      <FormField label="Viewer protocol policy" description="Protocol policy to apply to your distribution">
                        <Select
                          selectedOption={{ label: viewerProtocolPolicy === 'redirect-to-https' ? 'Redirect HTTP to HTTPS' : 
                                                viewerProtocolPolicy === 'https-only' ? 'HTTPS Only' : 
                                                'HTTP and HTTPS', value: viewerProtocolPolicy }}
                          onChange={({ detail }) => setViewerProtocolPolicy(detail.selectedOption.value || 'redirect-to-https')}
                          options={[
                            { label: 'Redirect HTTP to HTTPS', value: 'redirect-to-https' },
                            { label: 'HTTPS Only', value: 'https-only' },
                            { label: 'HTTP and HTTPS', value: 'allow-all' }
                          ]}
                        />
                      </FormField>
                    </SpaceBetween>
                  )
                },
                {
                  id: 'template',
                  label: 'From template',
                  content: (
                    <SpaceBetween size="l">
                      <FormField label="Select template" description="Choose a template to create your distribution">
                        <Select
                          placeholder="Choose a template"
                          selectedOption={selectedTemplate ? 
                            { label: templates.find(t => t.id === selectedTemplate)?.name || '', value: selectedTemplate } : 
                            null
                          }
                          onChange={({ detail }) => setSelectedTemplate(detail.selectedOption?.value || null)}
                          options={templates.map(template => ({
                            label: template.name,
                            value: template.id,
                            description: template.description
                          }))}
                          empty="No templates available"
                        />
                      </FormField>
                      
                      {selectedTemplate && (
                        <>
                          <Header variant="h3">Template Parameters</Header>
                          
                          <FormField label="Comment" description="Optional description for this distribution">
                            <Input
                              value={comment}
                              onChange={({ detail }) => setComment(detail.value)}
                              placeholder="My CloudFront distribution"
                            />
                          </FormField>
                          
                          <FormField label="Origin domain name" description="The DNS domain name of your origin">
                            <Input
                              value={originDomainName}
                              onChange={({ detail }) => setOriginDomainName(detail.value)}
                              placeholder="example-bucket.s3.amazonaws.com"
                            />
                          </FormField>
                          
                          <FormField label="Origin path" description="Optional path that CloudFront appends to the origin domain name">
                            <Input
                              value={originPath}
                              onChange={({ detail }) => setOriginPath(detail.value)}
                              placeholder="/production"
                            />
                          </FormField>
                        </>
                      )}
                    </SpaceBetween>
                  )
                }
              ]}
            />
          </SpaceBetween>
        </Form>
      </SpaceBetween>
    </Container>
  );
};

export default DistributionCreate;
